# -*- coding: utf-8 -*-
"""Shared entry: read main subtitle JSON, extract candidates, write output file."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Dict, Tuple

from .extractor import extract_candidates
from .strategies import apply_strategy_overrides, get_strategy

Logger = Callable[[str], None] | None


def load_subtitle_doc(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("主字幕 JSON 根节点必须是对象")
    segs = raw.get("segments")
    if not isinstance(segs, list):
        raise ValueError("缺少 segments[]")
    return raw


def extract_to_candidates_file(
    input_path: Path,
    output_path: Path | None,
    strategy_name: str,
    *,
    max_per_sentence: int | None = None,
    min_words: int | None = None,
    min_score: int | None = None,
    business_boost: bool | None = None,
    logger: Logger = None,
) -> Tuple[Path, Dict[str, Any]]:
    """
    business_boost: None = follow strategy preset after other overrides.
    max_per_sentence / min_words / min_score: pass None to use strategy defaults.
    """
    src = load_subtitle_doc(input_path)
    segs = src["segments"]
    assert isinstance(segs, list)

    base = get_strategy(strategy_name)
    strategy = apply_strategy_overrides(
        base,
        max_per_sentence=max_per_sentence,
        min_words=min_words,
        business_boost=business_boost,
        min_score=min_score,
    )
    result = extract_candidates(segs, strategy=strategy, logger=logger)

    video_id = src.get("video_id")
    stem = str(video_id or input_path.stem)
    outp = output_path.resolve() if output_path else input_path.with_name(f"{stem}_phrases_candidates.json")

    doc: Dict[str, Any] = {
        "version": 1,
        "video_id": video_id or "",
        "strategy": strategy.name,
        "params": {
            "max_per_sentence": strategy.max_per_sentence,
            "min_words": strategy.min_words,
            "business_boost": strategy.business_boost,
            "min_score": strategy.min_score,
        },
        "stats": result.stats,
        "items": result.items,
    }
    outp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return outp, doc
