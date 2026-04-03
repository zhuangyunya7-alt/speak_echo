from __future__ import annotations

import json
from dataclasses import asdict, fields
from pathlib import Path

from core.models import AppConfig, AssetRecord, QueuedJob, UploadTask


class LocalRepository:
  def __init__(self, base_dir: Path | None = None) -> None:
    project_root = Path(__file__).resolve().parents[1]
    self.base_dir = base_dir or (project_root / "data")
    self.base_dir.mkdir(parents=True, exist_ok=True)
    self.templates_dir = self.base_dir / "templates"
    self.templates_dir.mkdir(parents=True, exist_ok=True)
    self.config_file = self.base_dir / "config.json"
    self.assets_index_file = self.base_dir / "assets_index.json"
    self.job_queue_file = self.base_dir / "job_queue.json"

  def save_template(self, name: str, tasks: list[UploadTask]) -> Path:
    payload = {"name": name, "tasks": [asdict(t) for t in tasks]}
    out = self.templates_dir / f"{name}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out

  def load_template(self, name: str) -> list[UploadTask]:
    f = self.templates_dir / f"{name}.json"
    raw = json.loads(f.read_text(encoding="utf-8"))
    task_dicts = raw.get("tasks", [])
    return [UploadTask(**d) for d in task_dicts]

  def list_templates(self) -> list[str]:
    return sorted([p.stem for p in self.templates_dir.glob("*.json")])

  def save_config(self, config: AppConfig) -> Path:
    self.config_file.write_text(json.dumps(asdict(config), ensure_ascii=False, indent=2), encoding="utf-8")
    return self.config_file

  def load_config(self) -> AppConfig:
    if not self.config_file.exists():
      return AppConfig()
    raw = json.loads(self.config_file.read_text(encoding="utf-8"))
    allowed = {f.name for f in fields(AppConfig)}
    return AppConfig(**{k: v for k, v in raw.items() if k in allowed})

  def load_assets(self) -> list[AssetRecord]:
    if not self.assets_index_file.exists():
      return []
    raw = json.loads(self.assets_index_file.read_text(encoding="utf-8"))
    return [AssetRecord(**d) for d in raw.get("items", [])]

  def save_assets(self, assets: list[AssetRecord]) -> Path:
    payload = {"items": [asdict(a) for a in assets]}
    self.assets_index_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return self.assets_index_file

  def upsert_assets(self, records: list[AssetRecord]) -> None:
    current = self.load_assets()
    by_id = {r.asset_id: r for r in current}
    for r in records:
      by_id[r.asset_id] = r
    merged = sorted(by_id.values(), key=lambda x: x.created_at, reverse=True)
    self.save_assets(merged)

  def mark_asset_active(self, asset_id: str, active: bool) -> None:
    assets = self.load_assets()
    for a in assets:
      if a.asset_id == asset_id:
        a.active = active
        break
    self.save_assets(assets)

  def load_jobs(self) -> list[QueuedJob]:
    if not self.job_queue_file.exists():
      return []
    raw = json.loads(self.job_queue_file.read_text(encoding="utf-8"))
    allowed = {f.name for f in fields(QueuedJob)}
    out: list[QueuedJob] = []
    for d in raw.get("jobs", []):
      if not isinstance(d, dict):
        continue
      out.append(QueuedJob(**{k: v for k, v in d.items() if k in allowed}))
    return out

  def save_jobs(self, jobs: list[QueuedJob]) -> Path:
    payload = {"version": 1, "jobs": [asdict(j) for j in jobs]}
    self.job_queue_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return self.job_queue_file

  def append_jobs(self, new_jobs: list[QueuedJob]) -> None:
    cur = self.load_jobs()
    self.save_jobs(cur + new_jobs)
