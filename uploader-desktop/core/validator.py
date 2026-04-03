from __future__ import annotations

from pathlib import Path

from core.models import UploadTask


ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm"}
ALLOWED_JSON_EXT = {".json"}


def _must_exist(path_str: str, field_name: str) -> str | None:
  p = Path(path_str)
  if not path_str.strip():
    return f"{field_name} 不能为空"
  if not p.exists():
    return f"{field_name} 不存在: {path_str}"
  return None


def validate_task(task: UploadTask) -> list[str]:
  errors: list[str] = []
  if not task.title.strip():
    errors.append("视频标题不能为空")
  if not task.level.strip():
    errors.append("难度不能为空")
  if not task.category.strip():
    errors.append("分类不能为空")

  err = _must_exist(task.video_path, "视频文件")
  if err:
    errors.append(err)
  else:
    ext = Path(task.video_path).suffix.lower()
    if ext not in ALLOWED_VIDEO_EXT:
      errors.append(f"视频格式不支持: {ext}")

  err = _must_exist(task.subtitle_json_path, "字幕 JSON")
  if err:
    errors.append(err)
  else:
    ext = Path(task.subtitle_json_path).suffix.lower()
    if ext not in ALLOWED_JSON_EXT:
      errors.append("字幕文件必须是 .json")

  err = _must_exist(task.vocab_json_path, "难度 JSON")
  if err:
    errors.append(err)
  else:
    ext = Path(task.vocab_json_path).suffix.lower()
    if ext not in ALLOWED_JSON_EXT:
      errors.append("难度文件必须是 .json")

  err = _must_exist(task.vocab_display_json_path, "释义 JSON")
  if err:
    errors.append(err)
  else:
    ext = Path(task.vocab_display_json_path).suffix.lower()
    if ext not in ALLOWED_JSON_EXT:
      errors.append("释义文件必须是 .json")

  pph = task.phrases_json_path.strip()
  if pph:
    err = _must_exist(pph, "词组 JSON")
    if err:
      errors.append(err)
    elif Path(pph).suffix.lower() not in ALLOWED_JSON_EXT:
      errors.append("词组文件必须是 .json")

  return errors


def validate_replace_paths(
  subtitle_path: str, vocab_path: str, vocab_display_path: str = "", phrases_path: str = ""
) -> list[str]:
  errors: list[str] = []
  sub = subtitle_path.strip()
  voc = vocab_path.strip()
  vdisp = vocab_display_path.strip()
  vphrase = phrases_path.strip()
  if not sub and not voc and not vdisp and not vphrase:
    errors.append("至少选择一个要替换的字幕/难度/释义/词组 JSON 文件")
    return errors
  if sub:
    err = _must_exist(sub, "字幕 JSON")
    if err:
      errors.append(err)
    elif Path(sub).suffix.lower() != ".json":
      errors.append("字幕文件必须是 .json")
  if voc:
    err = _must_exist(voc, "难度 JSON")
    if err:
      errors.append(err)
    elif Path(voc).suffix.lower() != ".json":
      errors.append("难度文件必须是 .json")
  if vdisp:
    err = _must_exist(vdisp, "释义 JSON")
    if err:
      errors.append(err)
    elif Path(vdisp).suffix.lower() != ".json":
      errors.append("释义文件必须是 .json")
  if vphrase:
    err = _must_exist(vphrase, "词组 JSON")
    if err:
      errors.append(err)
    elif Path(vphrase).suffix.lower() != ".json":
      errors.append("词组文件必须是 .json")
  return errors
