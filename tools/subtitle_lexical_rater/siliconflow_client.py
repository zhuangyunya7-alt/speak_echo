# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Tuple


class SiliconFlowError(RuntimeError):
    pass


def _join_url(base_url: str, path: str) -> str:
    b = (base_url or "").strip() or "https://api.siliconflow.cn/v1"
    b = b.rstrip("/")
    p = (path or "").lstrip("/")
    return f"{b}/{p}"


def chat_completions(
    *,
    api_key: str,
    base_url: str,
    model: str,
    messages: List[Dict[str, str]],
    temperature: float = 0.2,
    timeout_seconds: float = 60.0,
) -> Tuple[str, Dict[str, Any]]:
    """
    Calls OpenAI-compatible /chat/completions.
    Returns: (assistant_content, raw_response_json)
    """
    if not api_key.strip():
        raise SiliconFlowError("API Key 为空。请在界面中填写并保存。")
    if not model.strip():
        raise SiliconFlowError("Model 为空。请填写硅基流动的模型 ID。")

    url = _join_url(base_url, "/chat/completions")
    payload: Dict[str, Any] = {
        "model": model.strip(),
        "messages": messages,
        "temperature": float(temperature),
    }

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key.strip()}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=float(timeout_seconds)) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        raise SiliconFlowError(f"HTTP {e.code}: {e.reason}\n{body}".strip()) from e
    except urllib.error.URLError as e:
        raise SiliconFlowError(f"网络错误：{e.reason}") from e

    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        raise SiliconFlowError(f"响应不是 JSON：{raw[:800]}") from e

    try:
        content = str(obj["choices"][0]["message"]["content"])
    except Exception as e:
        raise SiliconFlowError(f"响应结构异常：{raw[:1200]}") from e

    return content, obj

