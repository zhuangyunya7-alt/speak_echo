from __future__ import annotations

import json
from pathlib import Path


def default_taxonomy_path() -> Path:
  """core -> uploader-desktop -> speak_echo -> web/lib/domain/taxonomy.json"""
  root = Path(__file__).resolve().parent.parent.parent
  return root / "web" / "lib" / "domain" / "taxonomy.json"


def load_taxonomy(path: Path | None = None) -> dict[str, list[str]]:
  p = path or default_taxonomy_path()
  if not p.is_file():
    raise FileNotFoundError(f"未找到话题表: {p}")
  raw = json.loads(p.read_text(encoding="utf-8"))
  if not isinstance(raw, dict):
    raise ValueError("taxonomy.json 根节点必须是对象")
  out: dict[str, list[str]] = {}
  for k, v in raw.items():
    if not isinstance(k, str):
      continue
    if isinstance(v, list) and all(isinstance(x, str) for x in v):
      out[k] = list(v)
  if not out:
    raise ValueError("taxonomy.json 中没有有效的一级/二级话题")
  return out


def topic_combo(l1: str, l2: str) -> str:
  a, b = l1.strip(), l2.strip()
  if not a:
    return ""
  if not b:
    return a
  return f"{a}-{b}"


def parse_stored_category(cat: str, taxonomy: dict[str, list[str]]) -> tuple[str, str]:
  """还原表单中的一级/二级；与网站 topicCombo 一致。"""
  s = (cat or "").strip()
  if not s:
    return "", ""
  idx = s.find("-")
  if idx > 0:
    maybe_l1, maybe_l2 = s[:idx].strip(), s[idx + 1 :].strip()
    if maybe_l1 in taxonomy:
      return maybe_l1, maybe_l2
  if s in taxonomy:
    return s, ""
  return s, ""
