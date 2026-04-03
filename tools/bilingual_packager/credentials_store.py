# -*- coding: utf-8 -*-
"""Persist Tencent SecretId/SecretKey locally (optional)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

_DEFAULT_NAME = "bilingual_packager_credentials.json"


def config_path() -> Path:
    base = Path.home() / ".speak_echo"
    base.mkdir(parents=True, exist_ok=True)
    return base / _DEFAULT_NAME


def load_credentials() -> tuple[str, str]:
    p = config_path()
    if not p.is_file():
        return "", ""
    try:
        data: Dict[str, Any] = json.loads(p.read_text(encoding="utf-8"))
        sid = str(data.get("secret_id") or "").strip()
        skey = str(data.get("secret_key") or "").strip()
        return sid, skey
    except (OSError, json.JSONDecodeError):
        return "", ""


def save_credentials(secret_id: str, secret_key: str) -> None:
    p = config_path()
    p.write_text(
        json.dumps(
            {"secret_id": secret_id.strip(), "secret_key": secret_key.strip()},
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
