# -*- coding: utf-8 -*-
"""Evaluate phrase extraction presets across sample subtitle JSON files."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tools.phrase_extractor.extractor import extract_candidates
from tools.phrase_extractor.strategies import STRATEGIES


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _is_main_subtitle_json(p: Path) -> bool:
    n = p.name.lower()
    if not n.endswith(".json"):
        return False
    if n.endswith("_vocab_display.json") or n.endswith("_vocabulary_levels.json"):
        return False
    if n.endswith("_phrases_candidates.json") or n.endswith(".meta.json"):
        return False
    if n.startswith("."):
        return False
    return True


def _iter_input_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if _is_main_subtitle_json(path) else []
    return sorted([p for p in path.glob("*.json") if p.is_file() and _is_main_subtitle_json(p)])


def main() -> None:
    ap = argparse.ArgumentParser(description="Evaluate phrase extractor presets.")
    ap.add_argument("--input", required=True, help="Input JSON file or directory")
    args = ap.parse_args()

    in_path = Path(args.input).resolve()
    files = _iter_input_files(in_path)
    if not files:
        raise SystemExit(f"No input json files found under: {in_path}")

    for name, strategy in STRATEGIES.items():
        total_raw = 0
        total_deduped = 0
        total_aligned = 0
        total_sentences = 0
        files_ok = 0
        unique_phrase_texts: set[str] = set()
        for p in files:
            try:
                src = _load_json(p)
                segs = src.get("segments") if isinstance(src, dict) else None
                if not isinstance(segs, list):
                    continue
                result = extract_candidates(segs, strategy=strategy)
                total_raw += int(result.stats.get("raw_candidates", 0))
                total_deduped += int(result.stats.get("deduped_candidates", 0))
                total_aligned += int(result.stats.get("aligned_added", 0))
                total_sentences += int(result.stats.get("sentences", 0))
                for it in result.items:
                    t = str(it.get("text", "")).strip().lower()
                    if t:
                        unique_phrase_texts.add(t)
                files_ok += 1
            except Exception:
                continue
        align_rate_raw = (total_aligned / total_raw) if total_raw else 0.0
        align_rate_dedup = (total_aligned / total_deduped) if total_deduped else 0.0
        print(
            f"[{name}] files={files_ok} sentences={total_sentences} "
            f"raw={total_raw} deduped={total_deduped} aligned={total_aligned} "
            f"unique_texts={len(unique_phrase_texts)} "
            f"align/raw={align_rate_raw:.3f} align/dedup={align_rate_dedup:.3f}"
        )


if __name__ == "__main__":
    main()

