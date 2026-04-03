from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal


UploadStatus = Literal["pending", "validating", "uploading", "success", "failed"]
JobKind = Literal["upload_new", "replace_json", "update_meta"]
JobStatus = Literal["scheduled", "running", "success", "failed", "cancelled"]


@dataclass
class UploadTask:
  video_path: str
  title: str
  subtitle_json_path: str
  vocab_json_path: str
  level: str
  category: str
  description: str
  vocab_display_json_path: str = ""
  # 本地任选文件名；上传时写入 COS 键「字幕 stem + _phrases.json」，与站点按字幕 URL 推导一致。
  phrases_json_path: str = ""
  status: UploadStatus = "pending"
  progress: int = 0
  error: str | None = None


@dataclass
class UploadResult:
  task: UploadTask
  ok: bool
  message: str
  video_url: str | None = None
  subtitle_url: str | None = None
  vocab_url: str | None = None
  vocab_display_url: str | None = None
  phrases_url: str | None = None
  meta_url: str | None = None
  video_key: str | None = None
  subtitle_key: str | None = None
  vocab_key: str | None = None
  vocab_display_key: str | None = None
  phrases_key: str | None = None
  meta_key: str | None = None
  finished_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class QueuedJob:
  """本地任务队列：由 GUI 写入，`cli.run_due_jobs` 每分钟拉取到点任务执行。"""

  job_id: str
  kind: JobKind
  scheduled_at: str
  status: JobStatus = "scheduled"
  created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
  error: str | None = None
  # upload_new（与 UploadTask 字段一致，不含 status/progress/error）
  video_path: str = ""
  title: str = ""
  subtitle_json_path: str = ""
  vocab_json_path: str = ""
  vocab_display_json_path: str = ""
  phrases_json_path: str = ""
  level: str = ""
  category: str = ""
  description: str = ""
  # replace_json：覆盖已有 COS key，URL 不变
  replace_asset_id: str = ""
  replace_subtitle_path: str = ""
  replace_vocab_path: str = ""
  replace_vocab_display_path: str = ""
  replace_phrases_path: str = ""
  # update_meta：仅更新本地资产索引（软删/展示用）；线上 DB 需你自有 API
  meta_asset_id: str = ""
  meta_title: str = ""
  meta_level: str = ""
  meta_category: str = ""
  meta_description: str = ""


@dataclass
class AppConfig:
  publish_api_url: str = ""
  publish_api_token: str = ""
  cos_bucket: str = ""
  cos_region: str = ""
  cos_secret_id: str = ""
  cos_secret_key: str = ""
  cdn_domain: str = ""
  # 为空则使用 speak_echo/web/lib/domain/taxonomy.json
  taxonomy_json_path: str = ""


@dataclass
class AssetRecord:
  asset_id: str
  title: str
  level: str
  category: str
  description: str
  video_url: str
  subtitle_url: str
  vocab_url: str
  video_key: str
  subtitle_key: str
  vocab_key: str
  source_video_path: str
  meta_url: str = ""
  vocab_display_url: str = ""
  vocab_display_key: str = ""
  phrases_url: str = ""
  phrases_key: str = ""
  meta_key: str = ""
  created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
  active: bool = True
