# -*- coding: utf-8 -*-
"""
Merge Sonix.ai word-level CSV (Word, Start Timecode, End Timecode, Speaker)
into bilingual_packager subtitle JSON segments[].words[].

Each word is assigned to the cue with maximum time overlap, then aligned to
en_text whitespace tokens (SRT surfaces) via SequenceMatcher.
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _cue_ref_letters(en_text: str) -> str:
    toks = re.findall(r"[a-z']+", (en_text or "").lower())
    return " ".join(toks)


def _words_hyp_letters(words: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for w in words:
        if not isinstance(w, dict):
            continue
        raw = str((w.get("word") or w.get("text") or "") or "")
        parts.extend(re.findall(r"[a-z']+", raw.lower()))
    return " ".join(parts)


def _drop_words_without_letters(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for w in words:
        if not isinstance(w, dict):
            continue
        raw = str((w.get("word") or w.get("text") or "") or "")
        if re.search(r"[A-Za-z]", raw):
            out.append(w)
    return out


def _words_transcript_matches_cue(en_text: str, words: List[Dict[str, Any]]) -> Tuple[bool, float]:
    """Rough check that word surfaces match the cue English (letter-sequence + token recall)."""
    ref = _cue_ref_letters(en_text)
    hyp = _words_hyp_letters(words)
    if not ref:
        return (True, 1.0)
    if not hyp:
        return (False, 0.0)
    ratio = difflib.SequenceMatcher(None, ref, hyp).ratio()
    ref_set = set(ref.split())
    hyp_set = set(hyp.split())
    if not ref_set:
        return (True, 1.0)
    recall = len(ref_set & hyp_set) / len(ref_set)
    score = max(ratio, recall)
    nref = len(ref_set)
    if nref >= 8:
        ok = recall >= 0.22 and (ratio >= 0.28 or recall >= 0.42)
    elif nref >= 4:
        ok = ratio >= 0.32 or recall >= 0.45
    else:
        ok = ratio >= 0.38 or recall >= 0.52
    return (ok, score)


def _assign_words_to_cues_by_max_overlap(
    all_words: List[Dict[str, Any]],
    cue_spans: List[Tuple[float, float]],
    *,
    min_overlap: float = 0.005,
) -> List[List[Dict[str, Any]]]:
    n = len(cue_spans)
    buckets: List[List[Dict[str, Any]]] = [[] for _ in range(n)]
    for w in all_words:
        if not isinstance(w, dict):
            continue
        try:
            ws = float(w["start"])
            we = float(w["end"])
        except (TypeError, KeyError, ValueError):
            continue
        best_i = -1
        best_ov = 0.0
        for i, (cs, ce) in enumerate(cue_spans):
            ov = min(we, ce) - max(ws, cs)
            if ov > best_ov:
                best_ov = ov
                best_i = i
        if best_i >= 0 and best_ov >= min_overlap:
            surf = w.get("word") or w.get("text") or ""
            if not isinstance(surf, str):
                surf = str(surf)
            buckets[best_i].append({"word": surf.strip() or "?", "start": ws, "end": we})
    for b in buckets:
        b.sort(key=lambda x: (float(x["start"]), float(x["end"])))
    return buckets


def _parse_timecode(tc: str) -> float:
    """
    Supported formats:
    - Sonix-style 3-part: HH:MM:SS.cc  (seconds may be decimal, e.g. 01.50)
    - 4-part with integer sub-second field: HH:MM:SS:uuuuuu — fourth field is
      **microseconds** added to the integer seconds in the third field
      (e.g. 00:00:00:10800 → 0.0108s).
    """
    tc = (tc or "").strip()
    parts = tc.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    if len(parts) == 4:
        h, m, s, sub = parts
        try:
            micro = int(sub, 10)
        except ValueError as e:
            raise ValueError(f"Bad timecode: {tc!r}") from e
        return int(h) * 3600 + int(m) * 60 + float(s) + micro / 1_000_000.0
    raise ValueError(f"Bad timecode: {tc!r}")


def _load_sonix_csv(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            w = (r.get("Word") or "").strip()
            if not w:
                continue
            st = _parse_timecode(r.get("Start Timecode") or "")
            et = _parse_timecode(r.get("End Timecode") or "")
            rows.append({"word": w, "start": st, "end": et})
    return rows


def _norm_key(s: str) -> str:
    s = (s or "").strip().strip('"').strip("'")
    return s.lower()


def _interpolate_words(tokens: List[str], t0: float, t1: float) -> List[Dict[str, Any]]:
    if not tokens:
        return []
    if t1 <= t0:
        t1 = t0 + 0.02 * len(tokens)
    n = len(tokens)
    dur = (t1 - t0) / n
    out: List[Dict[str, Any]] = []
    for i, t in enumerate(tokens):
        s = t0 + i * dur
        e = t0 + (i + 1) * dur
        out.append({"word": t, "start": s, "end": e})
    return out


def _replace_block(
    en_sub: List[str], sx_sub: List[Dict[str, Any]], t_lo: float, t_hi: float
) -> List[Dict[str, Any]]:
    if not en_sub:
        return []
    if not sx_sub:
        return _interpolate_words(en_sub, t_lo, t_hi)
    t0 = float(sx_sub[0]["start"])
    t1 = float(sx_sub[-1]["end"])
    if len(en_sub) == len(sx_sub):
        return [
            {"word": e, "start": float(s["start"]), "end": float(s["end"])}
            for e, s in zip(en_sub, sx_sub)
        ]
    letters = [max(1, len(re.findall(r"[a-z']+", e.lower()))) for e in en_sub]
    total = sum(letters)
    span = max(t1 - t0, 0.02 * len(en_sub))
    cur = t0
    out: List[Dict[str, Any]] = []
    for i, e in enumerate(en_sub):
        frac = letters[i] / total
        d = span * frac
        out.append({"word": e, "start": cur, "end": cur + d})
        cur += d
    return out


def _align_en_tokens_to_sonix(
    en_tokens: List[str],
    sonix: List[Dict[str, Any]],
    seg_start: float,
    seg_end: float,
) -> List[Dict[str, Any]]:
    if not en_tokens:
        return []
    if not sonix:
        return _interpolate_words(en_tokens, seg_start, seg_end)
    a = [_norm_key(t) for t in en_tokens]
    b = [_norm_key(w["word"]) for w in sonix]
    sm = difflib.SequenceMatcher(None, a, b)
    out: List[Dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                w = sonix[j1 + k]
                out.append(
                    {
                        "word": en_tokens[i1 + k],
                        "start": float(w["start"]),
                        "end": float(w["end"]),
                    }
                )
        elif tag == "replace":
            en_sub = en_tokens[i1:i2]
            sx_sub = sonix[j1:j2]
            t_lo = out[-1]["end"] if out else seg_start
            t_hi = float(sx_sub[-1]["end"]) if sx_sub else seg_end
            if sx_sub:
                t_lo = max(t_lo, float(sx_sub[0]["start"]))
            out.extend(_replace_block(en_sub, sx_sub, t_lo, t_hi))
        elif tag == "delete":
            en_sub = en_tokens[i1:i2]
            t_lo = out[-1]["end"] if out else seg_start
            t_hi = float(sonix[j1]["start"]) if j1 < len(sonix) else seg_end
            out.extend(_interpolate_words(en_sub, t_lo, t_hi))
        elif tag == "insert":
            pass
    return out


def _clamp_words(words: List[Dict[str, Any]], lo: float, hi: float) -> List[Dict[str, Any]]:
    fixed: List[Dict[str, Any]] = []
    for w in words:
        s = max(lo, min(float(w["start"]), hi))
        e = max(lo, min(float(w["end"]), hi))
        if e < s:
            e = min(hi, s + 0.02)
        fixed.append({"word": w["word"], "start": s, "end": e})
    return fixed


def apply_sonix_csv_to_doc(doc: Dict[str, Any], csv_path: Path) -> Tuple[int, int]:
    """
    Fill segments[].words[] from Sonix CSV. Mutates doc in memory.
    Returns (segments_with_words, segments_cleared).
    """
    sonix = _load_sonix_csv(csv_path)
    if not sonix:
        raise RuntimeError(f"No words parsed from {csv_path}")

    segs = doc.get("segments")
    if not isinstance(segs, list) or not segs:
        raise RuntimeError("JSON missing segments[]")

    cues: List[Tuple[float, float]] = [
        (float(s["start"]), float(s["end"])) for s in segs if isinstance(s, dict)
    ]
    buckets = _assign_words_to_cues_by_max_overlap(sonix, cues, min_overlap=0.001)

    ok_n = 0
    bad_n = 0
    for idx, seg in enumerate(segs):
        if not isinstance(seg, dict):
            continue
        en = (seg.get("en_text") or "").strip()
        en_tokens = [t for t in re.split(r"\s+", en) if t]
        b = buckets[idx] if idx < len(buckets) else []
        aligned = _align_en_tokens_to_sonix(en_tokens, b, float(seg["start"]), float(seg["end"]))
        aligned = _drop_words_without_letters(aligned)
        aligned = _clamp_words(aligned, float(seg["start"]), float(seg["end"]))
        ok, _sc = _words_transcript_matches_cue(en, aligned)
        if ok and aligned:
            seg["words"] = aligned
            ok_n += 1
        else:
            seg["words"] = []
            bad_n += 1

    meta = doc.get("meta")
    if isinstance(meta, dict):
        meta["word_align"] = "sonix_csv"
        meta["sonix_csv"] = str(csv_path.resolve())

    return ok_n, bad_n


def merge_sonix_into_json(
    *,
    csv_path: Path,
    json_path: Path,
    backup: bool = True,
) -> Tuple[int, int]:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    ok_n, bad_n = apply_sonix_csv_to_doc(data, csv_path)

    if backup:
        bak = json_path.with_suffix(json_path.suffix + ".bak")
        if not bak.is_file():
            shutil.copy2(json_path, bak)

    json_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return ok_n, bad_n


def main() -> None:
    ap = argparse.ArgumentParser(description="Merge Sonix CSV word timings into subtitle JSON.")
    ap.add_argument("csv", type=Path, help="Sonix export CSV path")
    ap.add_argument("json", type=Path, help="Target subtitle JSON path")
    ap.add_argument("--no-backup", action="store_true", help="Do not write .json.bak")
    args = ap.parse_args()
    ok_n, bad_n = merge_sonix_into_json(
        csv_path=args.csv,
        json_path=args.json,
        backup=not args.no_backup,
    )
    print(f"Wrote {args.json}: segments with words={ok_n}, cleared (mismatch/empty)={bad_n}")


if __name__ == "__main__":
    main()
