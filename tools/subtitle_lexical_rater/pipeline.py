# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from bilingual_packager.srt_parse import parse_srt_file

from .metrics import compute_local_metrics
from .prompt import build_prompt
from .siliconflow_client import SiliconFlowError, chat_completions


def _safe_int(x: Any, *, lo: int, hi: int, default: int) -> int:
    try:
        v = int(x)
    except Exception:
        return default
    return max(lo, min(hi, v))


def _parse_llm_json(s: str) -> Dict[str, Any]:
    # Some models might wrap with ```json ... ```
    t = s.strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t.replace("json", "", 1).strip()
    return json.loads(t)


def rate_srt_file(
    *,
    srt_path: Path,
    api_key: str,
    base_url: str,
    model: str,
    temperature: float = 0.2,
) -> Dict[str, Any]:
    cues = parse_srt_file(Path(srt_path))
    local_m = compute_local_metrics(cues)
    local_d = asdict(local_m)

    out: Dict[str, Any] = {
        "schema_version": 1,
        "source": {"path": str(Path(srt_path)), "cue_count": local_m.cue_count},
        "local": local_d,
    }

    messages = build_prompt(local=local_d)
    content, raw_resp = chat_completions(
        api_key=api_key,
        base_url=base_url,
        model=model,
        messages=messages,
        temperature=temperature,
    )

    llm_obj = _parse_llm_json(content)
    stars = _safe_int(llm_obj.get("stars_1_5"), lo=1, hi=5, default=3)

    subs = llm_obj.get("subscores") or {}
    subscores = {
        "lexical": _safe_int(subs.get("lexical"), lo=0, hi=100, default=50),
        "length": _safe_int(subs.get("length"), lo=0, hi=100, default=50),
        "wpm": _safe_int(subs.get("wpm"), lo=0, hi=100, default=50),
    }

    llm_block = {
        "model": model,
        "raw_score": llm_obj.get("raw_score"),
        "stars_1_5": stars,
        "subscores": subscores,
        "rationale_zh": str(llm_obj.get("rationale_zh") or "").strip(),
        "difficult_words": llm_obj.get("difficult_words") or [],
    }

    out["llm"] = llm_block
    out["_raw_response"] = raw_resp  # useful for debugging; can be removed later
    return out


def rate_srt_file_best_effort(
    *,
    srt_path: Path,
    api_key: str,
    base_url: str,
    model: str,
    temperature: float = 0.2,
) -> Dict[str, Any]:
    """
    Never throws: returns a dict with either llm or error.
    """
    try:
        return rate_srt_file(
            srt_path=srt_path,
            api_key=api_key,
            base_url=base_url,
            model=model,
            temperature=temperature,
        )
    except Exception as e:
        cues = parse_srt_file(Path(srt_path))
        local_m = compute_local_metrics(cues)
        out: Dict[str, Any] = {
            "schema_version": 1,
            "source": {"path": str(Path(srt_path)), "cue_count": local_m.cue_count},
            "local": asdict(local_m),
            "error": {"message": str(e)},
        }
        return out

