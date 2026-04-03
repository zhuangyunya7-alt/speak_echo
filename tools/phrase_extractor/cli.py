# -*- coding: utf-8 -*-
"""CLI for offline phrase candidate extraction."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tools.phrase_extractor.run_extract import extract_to_candidates_file


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract phrase candidates from subtitle JSON.")
    ap.add_argument("--input", required=True, help="Path to input subtitle json")
    ap.add_argument("--output", default="", help="Path to output candidates json")
    ap.add_argument(
        "--strategy",
        default="balanced",
        choices=["aggressive", "balanced", "conservative"],
        help="Extraction strategy preset",
    )
    ap.add_argument(
        "--max-per-sentence",
        type=int,
        default=None,
        metavar="N",
        help="Override preset: max aligned phrases kept per sentence",
    )
    ap.add_argument(
        "--min-words",
        type=int,
        default=None,
        metavar="N",
        help="Override preset: minimum token count for a candidate phrase",
    )
    ap.add_argument(
        "--min-score",
        type=int,
        default=None,
        metavar="N",
        help="Override preset: minimum score to keep a candidate",
    )
    biz = ap.add_mutually_exclusive_group()
    biz.add_argument(
        "--business-boost",
        action="store_true",
        help="Override preset: force business lexicon boost on",
    )
    biz.add_argument(
        "--no-business-boost",
        action="store_true",
        help="Override preset: force business lexicon boost off",
    )
    args = ap.parse_args()

    inp = Path(args.input).resolve()
    if not inp.is_file():
        raise SystemExit(f"Input not found: {inp}")

    outp = Path(args.output).resolve() if args.output.strip() else None

    biz_val: bool | None = None
    if args.business_boost:
        biz_val = True
    elif args.no_business_boost:
        biz_val = False

    out_path, _doc = extract_to_candidates_file(
        inp,
        outp,
        args.strategy,
        max_per_sentence=args.max_per_sentence,
        min_words=args.min_words,
        min_score=args.min_score,
        business_boost=biz_val,
        logger=print,
    )
    print(f"written: {out_path}")


if __name__ == "__main__":
    main()
