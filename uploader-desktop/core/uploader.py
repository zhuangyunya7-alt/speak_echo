from __future__ import annotations

import json
import os
import re
from datetime import datetime
import time
import tempfile
import uuid
from pathlib import Path
from typing import Callable, Protocol

import requests
from qcloud_cos import CosConfig, CosS3Client

from core.models import AppConfig, UploadResult, UploadTask
from core.validator import validate_task


ProgressCallback = Callable[[int, int, str], None]

# COS 对象键一段的长度上限（留余量避免整 key 过长）
_MAX_FOLDER_SEGMENT_LEN = 180


def cos_phrases_object_key(subtitle_local_path: str, asset_folder: str) -> str:
  """与站点根据字幕 URL 推导的 `{stem}_phrases.json` 一致。"""
  stem = Path(subtitle_local_path).stem
  return f"{asset_folder}/{stem}_phrases.json"


def cos_folder_from_video_title(title: str) -> str:
  """
  用「网站内容后台」里填写的视频标题作为 videos/ 下的一级文件夹名。
  去掉路径分隔与非法字符；同一标题重复上传会覆盖同一路径下文件。
  """
  t = (title or "").strip()
  if not t:
    t = "untitled"
  t = t.replace("\\", "_").replace("/", "_").replace("..", "_")
  t = "".join(c for c in t if ord(c) >= 32 and c not in "\r\n\t")
  t = re.sub(r"\s+", " ", t).strip()
  t = t.rstrip(". ")
  if not t:
    t = "untitled"
  if len(t.encode("utf-8")) > _MAX_FOLDER_SEGMENT_LEN:
    enc = t.encode("utf-8")[:_MAX_FOLDER_SEGMENT_LEN]
    t = enc.decode("utf-8", errors="ignore").rstrip()
    if not t:
      t = "untitled"
  return t


class UploadBackend(Protocol):
  def upload(self, task: UploadTask, config: AppConfig, on_progress: Callable[[int, str], None]) -> UploadResult:
    ...

  def delete_keys(self, config: AppConfig, keys: list[str]) -> None:
    ...


class MockUploadBackend:
  """Phase-1 mock backend. Replace with real COS/Supabase implementation in phase-2."""

  def upload_overwrite_files(
    self, config: AppConfig, pairs: list[tuple[str, str]], on_progress: Callable[[int, str], None]
  ) -> None:
    for i, (_key, _path) in enumerate(pairs):
      pct = int(100 * (i + 1) / max(1, len(pairs)))
      on_progress(pct, f"Mock 覆盖 {_key}")

  def upload(self, task: UploadTask, config: AppConfig, on_progress: Callable[[int, str], None]) -> UploadResult:
    video_name = Path(task.video_path).name
    subtitle_name = Path(task.subtitle_json_path).name
    vocab_name = Path(task.vocab_json_path).name
    vocab_display_name = Path(task.vocab_display_json_path).name
    phrases_local = task.phrases_json_path.strip()
    folder = cos_folder_from_video_title(task.title)
    base_key = f"videos/{folder}"
    phrases_key = cos_phrases_object_key(task.subtitle_json_path, base_key) if phrases_local else ""
    video_key = f"{base_key}/{video_name}"
    subtitle_key = f"{base_key}/{subtitle_name}"
    vocab_key = f"{base_key}/{vocab_name}"
    vocab_display_key = f"{base_key}/{vocab_display_name}"
    meta_key = f"{base_key}/meta.json"

    for value, message in [
      (10, "校验中"),
      (30, "上传视频"),
      (52, "上传字幕"),
      (72, "上传难度"),
      (88, "上传释义"),
      (95, "上传元数据"),
      (100, "写入元数据"),
    ]:
      on_progress(value, message)
      time.sleep(0.12)

    base = config.cos_bucket or "mock-bucket"
    video_url = f"https://{base}.example.com/{video_key}"
    subtitle_url = f"https://{base}.example.com/{subtitle_key}"
    vocab_url = f"https://{base}.example.com/{vocab_key}"
    vocab_display_url = f"https://{base}.example.com/{vocab_display_key}"
    phrases_url = f"https://{base}.example.com/{phrases_key}" if phrases_key else None
    meta_url = f"https://{base}.example.com/{meta_key}"

    return UploadResult(
      task=task,
      ok=True,
      message="上传完成（Mock）",
      video_url=video_url,
      subtitle_url=subtitle_url,
      vocab_url=vocab_url,
      vocab_display_url=vocab_display_url,
      phrases_url=phrases_url,
      meta_url=meta_url,
      video_key=video_key,
      subtitle_key=subtitle_key,
      vocab_key=vocab_key,
      vocab_display_key=vocab_display_key,
      phrases_key=phrases_key or None,
      meta_key=meta_key,
    )

  def delete_keys(self, config: AppConfig, keys: list[str]) -> None:
    return


class CosUploadBackend:
  def _client(self, config: AppConfig) -> CosS3Client:
    cos_config = CosConfig(Region=config.cos_region, SecretId=config.cos_secret_id, SecretKey=config.cos_secret_key)
    return CosS3Client(cos_config)

  def _build_url(self, config: AppConfig, key: str) -> str:
    if config.cdn_domain.strip():
      domain = config.cdn_domain.strip().rstrip("/")
      if not domain.startswith("http"):
        domain = f"https://{domain}"
      return f"{domain}/{key}"
    return f"https://{config.cos_bucket}.cos.{config.cos_region}.myqcloud.com/{key}"

  def _check_object_exists(self, client: CosS3Client, bucket: str, key: str) -> None:
    """用凭证 HeadObject，私有桶也可校验（不再依赖匿名 GET 公网 URL）。"""
    try:
      client.head_object(Bucket=bucket, Key=key)
    except Exception as exc:
      raise RuntimeError(f"COS 对象校验失败: {key} ({exc})") from exc

  def _verify_uploaded_objects(
    self,
    client: CosS3Client,
    bucket: str,
    video_key: str,
    subtitle_key: str,
    vocab_key: str,
    vocab_display_key: str,
    meta_key: str,
    on_progress: Callable[[int, str], None],
    phrases_key: str | None = None,
  ) -> None:
    checks: list[tuple[int, str, str]] = [
      (94, "校验视频对象", video_key),
      (95, "校验字幕 JSON", subtitle_key),
      (97, "校验难度 JSON", vocab_key),
      (98, "校验释义 JSON", vocab_display_key),
    ]
    if phrases_key:
      checks.append((98, "校验词组 JSON", phrases_key))
    checks.append((99, "校验元数据 JSON", meta_key))
    for pct, label, key in checks:
      on_progress(pct, label)
      self._check_object_exists(client, bucket, key)

  def _upload_one(
    self,
    client: CosS3Client,
    bucket: str,
    key: str,
    file_path: str,
    progress_range: tuple[int, int],
    stage_text: str,
    on_progress: Callable[[int, str], None],
  ) -> None:
    start, end = progress_range
    span = max(1, end - start)

    def _cb(consumed: int, total: int) -> None:
      if total <= 0:
        return
      ratio = max(0.0, min(1.0, consumed / total))
      value = start + int(span * ratio)
      on_progress(value, f"{stage_text} {int(ratio * 100)}%")

    # Multipart upload with callback: avoids "stuck at 20%" visual issue.
    client.upload_file(
      Bucket=bucket,
      LocalFilePath=file_path,
      Key=key,
      PartSize=8,
      MAXThread=4,
      progress_callback=_cb,
    )
    on_progress(end, f"{stage_text} 完成")

  def upload_overwrite_files(
    self, config: AppConfig, pairs: list[tuple[str, str]], on_progress: Callable[[int, str], None]
  ) -> None:
    if not (config.cos_bucket and config.cos_region and config.cos_secret_id and config.cos_secret_key):
      raise RuntimeError("COS 配置不完整，请填写 bucket/region/secret_id/secret_key")
    if not pairs:
      return
    client = self._client(config)
    bucket = config.cos_bucket
    n = len(pairs)
    for i, (key, local_path) in enumerate(pairs):
      lo = int(90 * i / n)
      hi = int(90 * (i + 1) / n)
      self._upload_one(client, bucket, key, local_path, (lo, hi), f"覆盖 {Path(key).name}", on_progress)
    on_progress(100, "覆盖完成")

  def upload(self, task: UploadTask, config: AppConfig, on_progress: Callable[[int, str], None]) -> UploadResult:
    if not (config.cos_bucket and config.cos_region and config.cos_secret_id and config.cos_secret_key):
      raise RuntimeError("COS 配置不完整，请填写 bucket/region/secret_id/secret_key")

    client = self._client(config)
    bucket = config.cos_bucket

    folder = cos_folder_from_video_title(task.title)
    asset_folder = f"videos/{folder}"
    video_name = Path(task.video_path).name
    subtitle_name = Path(task.subtitle_json_path).name
    vocab_name = Path(task.vocab_json_path).name
    vocab_display_name = Path(task.vocab_display_json_path).name
    phrases_local = task.phrases_json_path.strip()
    phrases_key = cos_phrases_object_key(task.subtitle_json_path, asset_folder) if phrases_local else ""
    video_key = f"{asset_folder}/{video_name}"
    subtitle_key = f"{asset_folder}/{subtitle_name}"
    vocab_key = f"{asset_folder}/{vocab_name}"
    vocab_display_key = f"{asset_folder}/{vocab_display_name}"
    meta_key = f"{asset_folder}/meta.json"

    on_progress(18, f"准备上传到 {asset_folder}/")
    self._upload_one(client, bucket, video_key, task.video_path, (20, 52), "上传视频", on_progress)
    self._upload_one(client, bucket, subtitle_key, task.subtitle_json_path, (52, 68), "上传字幕", on_progress)
    self._upload_one(client, bucket, vocab_key, task.vocab_json_path, (68, 80), "上传难度", on_progress)
    self._upload_one(client, bucket, vocab_display_key, task.vocab_display_json_path, (80, 88), "上传释义", on_progress)
    if phrases_key:
      self._upload_one(client, bucket, phrases_key, phrases_local, (88, 90), "上传词组", on_progress)

    meta_payload = {
      "title": task.title,
      "level": task.level,
      "category": task.category,
      "description": task.description,
      "categories": [task.category] if task.category else [],
      "updated_at": datetime.utcnow().isoformat(),
    }
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", encoding="utf-8", delete=False) as tf:
      meta_json_path = tf.name
      tf.write(json.dumps(meta_payload, ensure_ascii=False, indent=2))
    try:
      self._upload_one(client, bucket, meta_key, meta_json_path, (90, 92), "上传元数据", on_progress)
    finally:
      try:
        os.unlink(meta_json_path)
      except OSError:
        pass

    video_url = self._build_url(config, video_key)
    subtitle_url = self._build_url(config, subtitle_key)
    vocab_url = self._build_url(config, vocab_key)
    vocab_display_url = self._build_url(config, vocab_display_key)
    phrases_url = self._build_url(config, phrases_key) if phrases_key else None
    meta_url = self._build_url(config, meta_key)

    if config.publish_api_url.strip():
      on_progress(92, "写入发布接口")
      payload = {
        "title": task.title,
        "level": task.level,
        "category": task.category,
        "description": task.description,
        "video_url": video_url,
        "subtitle_url": subtitle_url,
        "vocab_url": vocab_url,
        "vocab_display_url": vocab_display_url,
        "phrases_url": phrases_url,
        "meta_url": meta_url,
      }
      headers = {"Content-Type": "application/json"}
      if config.publish_api_token.strip():
        headers["x-publish-token"] = config.publish_api_token.strip()
      resp = requests.post(config.publish_api_url.strip(), data=json.dumps(payload), headers=headers, timeout=20)
      if resp.status_code >= 300:
        raise RuntimeError(f"发布接口失败: {resp.status_code} {resp.text[:200]}")

    self._verify_uploaded_objects(
      client,
      bucket,
      video_key,
      subtitle_key,
      vocab_key,
      vocab_display_key,
      meta_key,
      on_progress,
      phrases_key or None,
    )
    on_progress(100, "上传完成")
    result = UploadResult(
      task=task,
      ok=True,
      message="上传完成",
      video_url=video_url,
      subtitle_url=subtitle_url,
      vocab_url=vocab_url,
      vocab_display_url=vocab_display_url,
      phrases_url=phrases_url,
      meta_url=meta_url,
      video_key=video_key,
      subtitle_key=subtitle_key,
      vocab_key=vocab_key,
      vocab_display_key=vocab_display_key,
      phrases_key=phrases_key or None,
      meta_key=meta_key,
    )
    return result

  def delete_keys(self, config: AppConfig, keys: list[str]) -> None:
    if not keys:
      return
    client = self._client(config)
    for key in keys:
      client.delete_object(Bucket=config.cos_bucket, Key=key)


class UploadService:
  def __init__(self, backend: UploadBackend | None = None) -> None:
    self.backend = backend

  def pick_backend(self, config: AppConfig) -> UploadBackend:
    return self._pick_backend(config)

  def _pick_backend(self, config: AppConfig) -> UploadBackend:
    if self.backend:
      return self.backend
    strict_real = os.getenv("SPEAKECHO_UPLOADER_STRICT_REAL", "").strip().lower() in {"1", "true", "yes"}
    if config.publish_api_url.strip():
      strict_real = True
    if config.cos_bucket and config.cos_region and config.cos_secret_id and config.cos_secret_key:
      return CosUploadBackend()
    if strict_real:
      raise RuntimeError("当前为生产严格模式：缺少 COS 配置，已禁止回退到 Mock 上传。")
    return MockUploadBackend()

  def run_batch(self, tasks: list[UploadTask], config: AppConfig, on_progress: ProgressCallback) -> list[UploadResult]:
    results: list[UploadResult] = []
    try:
      backend = self._pick_backend(config)
    except Exception as exc:
      msg = str(exc)
      for idx, task in enumerate(tasks):
        task.status = "failed"
        task.error = msg
        on_progress(idx, task.progress, f"失败: {msg}")
        results.append(UploadResult(task=task, ok=False, message=f"上传异常: {msg}"))
      return results
    for idx, task in enumerate(tasks):
      task.status = "validating"
      on_progress(idx, task.progress, "校验中")
      errors = validate_task(task)
      if errors:
        task.status = "failed"
        task.error = "; ".join(errors)
        on_progress(idx, task.progress, task.error)
        results.append(UploadResult(task=task, ok=False, message=task.error))
        continue

      task.status = "uploading"

      def _single_progress(percent: int, message: str) -> None:
        task.progress = percent
        on_progress(idx, percent, message)

      try:
        result = backend.upload(task, config, _single_progress)
      except Exception as exc:
        task.status = "failed"
        task.error = str(exc)
        on_progress(idx, task.progress, f"失败: {task.error}")
        results.append(UploadResult(task=task, ok=False, message=f"上传异常: {exc}"))
        continue

      task.status = "success" if result.ok else "failed"
      task.error = None if result.ok else result.message
      on_progress(idx, task.progress, result.message)
      results.append(result)
    return results

  def delete_asset_objects(self, config: AppConfig, keys: list[str]) -> None:
    backend = self._pick_backend(config)
    backend.delete_keys(config, keys)
