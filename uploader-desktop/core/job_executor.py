from __future__ import annotations

import json
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable

import requests

from core.models import AppConfig, AssetRecord, QueuedJob, UploadResult, UploadTask
from core.uploader import UploadService
from core.validator import validate_replace_paths, validate_task
from storage.repository import LocalRepository

ProgressCb = Callable[[str], None]


def _phrases_key_from_subtitle_key(subtitle_key: str) -> str:
  p = Path(subtitle_key)
  return str(p.with_name(f"{p.stem}_phrases.json"))


def _now_iso() -> str:
  return datetime.now().replace(microsecond=0).isoformat()


def parse_job_time(iso_s: str) -> datetime | None:
  s = (iso_s or "").strip()
  if not s:
    return None
  if s.endswith("Z"):
    s = s[:-1]
  try:
    return datetime.fromisoformat(s)
  except ValueError:
    return None


def job_is_due(job: QueuedJob, now: datetime | None = None) -> bool:
  if job.status != "scheduled":
    return False
  t = parse_job_time(job.scheduled_at)
  if not t:
    return True
  ref = now or datetime.now()
  return t <= ref


def job_to_upload_task(job: QueuedJob) -> UploadTask:
  return UploadTask(
    video_path=job.video_path,
    title=job.title,
    subtitle_json_path=job.subtitle_json_path,
    vocab_json_path=job.vocab_json_path,
    level=job.level,
    category=job.category,
    description=job.description,
    vocab_display_json_path=job.vocab_display_json_path,
    phrases_json_path=job.phrases_json_path,
  )


def _result_to_asset(r: UploadResult, task: UploadTask) -> AssetRecord | None:
  if not (
    r.ok
    and r.video_url
    and r.subtitle_url
    and r.vocab_url
    and r.vocab_display_url
    and r.meta_url
    and r.video_key
    and r.subtitle_key
    and r.vocab_key
    and r.vocab_display_key
    and r.meta_key
  ):
    return None
  return AssetRecord(
    asset_id=uuid.uuid4().hex,
    title=task.title,
    level=task.level,
    category=task.category,
    description=task.description,
    video_url=r.video_url,
    subtitle_url=r.subtitle_url,
    vocab_url=r.vocab_url,
    vocab_display_url=r.vocab_display_url,
    phrases_url=r.phrases_url or "",
    meta_url=r.meta_url or "",
    video_key=r.video_key,
    subtitle_key=r.subtitle_key,
    vocab_key=r.vocab_key,
    source_video_path=task.video_path,
    vocab_display_key=r.vocab_display_key,
    phrases_key=r.phrases_key or "",
    meta_key=r.meta_key or "",
    created_at=_now_iso(),
    active=True,
  )


def _sync_meta_to_publish_api(config: AppConfig, asset: AssetRecord) -> None:
  api_url = config.publish_api_url.strip()
  if not api_url:
    return
  payload = {
    "action": "update_meta",
    "asset_id": asset.asset_id,
    "title": asset.title,
    "level": asset.level,
    "category": asset.category,
    "description": asset.description,
    "video_url": asset.video_url,
    "subtitle_url": asset.subtitle_url,
    "vocab_url": asset.vocab_url,
    "vocab_display_url": asset.vocab_display_url,
    "phrases_url": asset.phrases_url,
    "meta_url": asset.meta_url,
    "video_key": asset.video_key,
    "subtitle_key": asset.subtitle_key,
    "vocab_key": asset.vocab_key,
    "vocab_display_key": asset.vocab_display_key,
    "phrases_key": asset.phrases_key,
    "meta_key": asset.meta_key,
  }
  headers = {"Content-Type": "application/json"}
  resp = requests.patch(api_url, json=payload, headers=headers, timeout=20)
  if resp.status_code in {404, 405}:
    # Backward compatibility for APIs that only accept POST.
    resp = requests.post(api_url, data=json.dumps(payload), headers=headers, timeout=20)
  if resp.status_code >= 300:
    raise RuntimeError(f"元数据同步线上失败: {resp.status_code} {resp.text[:200]}")


def run_single_job(
  job: QueuedJob,
  repo: LocalRepository,
  config: AppConfig,
  service: UploadService,
  on_log: ProgressCb | None = None,
) -> QueuedJob:
  def log(msg: str) -> None:
    if on_log:
      on_log(msg)

  job.status = "running"
  job.error = None
  try:
    if job.kind == "upload_new":
      task = job_to_upload_task(job)
      errs = validate_task(task)
      if errs:
        raise RuntimeError("; ".join(errs))
      backend = service.pick_backend(config)

      def _p(pct: int, msg: str) -> None:
        log(f"{pct}% {msg}")

      result = backend.upload(task, config, _p)
      if not result.ok:
        raise RuntimeError(result.message)
      rec = _result_to_asset(result, task)
      if rec:
        repo.upsert_assets([rec])
      log("upload_new 完成")

    elif job.kind == "replace_json":
      errs = validate_replace_paths(
        job.replace_subtitle_path,
        job.replace_vocab_path,
        job.replace_vocab_display_path,
        job.replace_phrases_path,
      )
      if errs:
        raise RuntimeError("; ".join(errs))
      assets = repo.load_assets()
      target = next((a for a in assets if a.asset_id == job.replace_asset_id), None)
      if not target:
        raise RuntimeError("未找到资产 replace_asset_id")
      pairs: list[tuple[str, str]] = []
      if job.replace_subtitle_path.strip() and target.subtitle_key:
        pairs.append((target.subtitle_key, job.replace_subtitle_path.strip()))
      if job.replace_vocab_path.strip() and target.vocab_key:
        pairs.append((target.vocab_key, job.replace_vocab_path.strip()))
      if job.replace_vocab_display_path.strip() and target.vocab_display_key:
        pairs.append((target.vocab_display_key, job.replace_vocab_display_path.strip()))
      if job.replace_phrases_path.strip():
        pk = (target.phrases_key or "").strip() or (
          _phrases_key_from_subtitle_key(target.subtitle_key) if target.subtitle_key else ""
        )
        if pk:
          pairs.append((pk, job.replace_phrases_path.strip()))
      if not pairs:
        raise RuntimeError("无可替换的 key（检查字幕/难度/词组路径与索引中的 key）")
      backend = service.pick_backend(config)
      uploader = getattr(backend, "upload_overwrite_files", None)
      if not uploader:
        raise RuntimeError("当前后端不支持覆盖上传（请配置 COS）")
      uploader(config, pairs, lambda p, m: log(f"{p}% {m}"))
      log("replace_json 完成")

    elif job.kind == "update_meta":
      if not job.meta_asset_id.strip():
        raise RuntimeError("meta_asset_id 为空")
      assets = repo.load_assets()
      found = False
      for a in assets:
        if a.asset_id == job.meta_asset_id.strip():
          found = True
          if job.meta_title.strip():
            a.title = job.meta_title.strip()
          if job.meta_level.strip():
            a.level = job.meta_level.strip()
          if job.meta_category.strip():
            a.category = job.meta_category.strip()
          if job.meta_description.strip():
            a.description = job.meta_description.strip()
          break
      if not found:
        raise RuntimeError("未找到资产 meta_asset_id")
      target = next((a for a in assets if a.asset_id == job.meta_asset_id.strip()), None)
      if not target:
        raise RuntimeError("未找到资产 meta_asset_id")
      if config.publish_api_url.strip():
        log("同步线上元数据")
        _sync_meta_to_publish_api(config, target)

      # Keep COS meta.json consistent with local index.
      if target.meta_key:
        backend = service.pick_backend(config)
        uploader = getattr(backend, "upload_overwrite_files", None)
        if not uploader:
          raise RuntimeError("当前后端不支持覆盖上传（请配置 COS）")

        meta_payload = {
          "title": target.title,
          "level": target.level,
          "category": target.category,
          "description": target.description,
          "categories": [target.category] if target.category else [],
          "updated_at": datetime.utcnow().isoformat(),
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", encoding="utf-8", delete=False) as tf:
          meta_path = tf.name
          tf.write(json.dumps(meta_payload, ensure_ascii=False, indent=2))
        try:
          uploader(config, [(target.meta_key, meta_path)], lambda p, m: log(f"{p}% {m}"))
        finally:
          try:
            # Best-effort cleanup
            import os as _os

            _os.unlink(meta_path)
          except OSError:
            pass
      repo.save_assets(assets)
      log("update_meta 完成")

    else:
      raise RuntimeError(f"未知任务类型: {job.kind}")

    job.status = "success"
  except Exception as exc:
    job.status = "failed"
    job.error = str(exc)
    log(f"失败: {exc}")
  return job


def run_due_jobs(
  repo: LocalRepository,
  config: AppConfig,
  service: UploadService | None = None,
  on_log: ProgressCb | None = None,
) -> tuple[int, int]:
  """执行所有已到点且状态为 scheduled 的任务。返回 (成功数, 失败数)."""
  svc = service or UploadService()
  jobs = repo.load_jobs()
  now = datetime.now()
  due = [j for j in jobs if j.status == "scheduled" and job_is_due(j, now)]
  due.sort(key=lambda j: (parse_job_time(j.scheduled_at) or datetime.min).isoformat())

  ok_n = fail_n = 0
  by_id = {j.job_id: j for j in jobs}
  for j in due:
    updated = run_single_job(by_id[j.job_id], repo, config, svc, on_log)
    by_id[updated.job_id] = updated
    if updated.status == "success":
      ok_n += 1
    else:
      fail_n += 1
  repo.save_jobs(list(by_id.values()))
  return ok_n, fail_n
