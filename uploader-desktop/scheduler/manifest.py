from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from core.models import UploadTask


def write_manifest(tasks: list[UploadTask], out_file: Path) -> Path:
  out_file.parent.mkdir(parents=True, exist_ok=True)
  payload = {
    "version": 1,
    "tasks": [asdict(t) for t in tasks],
  }
  out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
  return out_file


def read_manifest(manifest_file: Path) -> list[UploadTask]:
  raw = json.loads(manifest_file.read_text(encoding="utf-8"))
  return [UploadTask(**d) for d in raw.get("tasks", [])]
