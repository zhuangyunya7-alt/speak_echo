# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Tuple

_DEFAULT_NAME = "subtitle_lexical_rater_credentials.json"


def config_path() -> Path:
    base = Path.home() / ".speak_echo"
    base.mkdir(parents=True, exist_ok=True)
    return base / _DEFAULT_NAME


def load_credentials() -> Tuple[str, str, str]:
    """Returns (api_key, base_url, model)."""
    p = config_path()
    if not p.is_file():
        return "", "", ""
    try:
        data: Dict[str, Any] = json.loads(p.read_text(encoding="utf-8"))
        api_key = str(data.get("api_key") or "").strip()
        base_url = str(data.get("base_url") or "").strip()
        model = str(data.get("model") or "").strip()
        return api_key, base_url, model
    except (OSError, json.JSONDecodeError):
        return "", "", ""


def save_credentials(*, api_key: str, base_url: str, model: str) -> None:
    p = config_path()
    p.write_text(
        json.dumps(
            {"api_key": api_key.strip(), "base_url": base_url.strip(), "model": model.strip()},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def clear_credentials() -> None:
    p = config_path()
    if p.is_file():
        p.unlink()

