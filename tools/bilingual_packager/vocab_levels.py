# -*- coding: utf-8 -*-
"""Build {prefix}_vocabulary_levels.json using D:\\speak_echo\\levels word lists."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Set


def load_lines(path: Path) -> Set[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    return {line.strip() for line in text.splitlines() if line.strip()}


def build_exclusive_sets(levels_dir: Path) -> tuple[Set[str], Set[str], Set[str]]:
    p4 = levels_dir / "CET-4.txt"
    p6 = levels_dir / "CET-6.txt"
    pi = levels_dir / "IELTS.txt"
    if not p4.is_file() or not p6.is_file() or not pi.is_file():
        raise FileNotFoundError(f"需要 {p4}, {p6}, {pi}")
    raw4 = load_lines(p4)
    raw6 = load_lines(p6)
    rawi = load_lines(pi)
    cet4 = set(raw4)
    cet6 = raw6 - cet4
    ielts = rawi - cet4 - cet6
    return cet4, cet6, ielts


def normalize_lemma(w: str) -> str:
    s = w.strip().lower()
    s = re.sub(r"^[^a-z]+", "", s, flags=re.I)
    s = re.sub(r"[^a-z]+$", "", s, flags=re.I)
    return s


def _lemmas_from_english_text(text: str) -> Set[str]:
    out: Set[str] = set()
    for m in re.finditer(r"[A-Za-z']+", text or ""):
        lem = normalize_lemma(m.group(0))
        if len(lem) > 2:
            out.add(lem)
    return out


def lemmas_from_segments(segments: List[Dict[str, Any]]) -> Set[str]:
    """
    词形来源：words[]（词级对齐）与 en_text/text（整句英文）并集。
    仅跑 SRT、未上传媒体时 words[] 全空，若只靠 words 则分级词表恒为空。
    """
    seen: Set[str] = set()
    for seg in segments:
        for wt in seg.get("words") or []:
            if not isinstance(wt, dict):
                continue
            w = (wt.get("word") or wt.get("w") or wt.get("text") or "").strip()
            if not w:
                continue
            lem = normalize_lemma(w)
            if len(lem) <= 2:
                continue
            seen.add(lem)
        en = (seg.get("en_text") or seg.get("text") or "").strip()
        if en:
            seen |= _lemmas_from_english_text(en)
    return seen


def build_vocabulary_levels_json(
    segments: List[Dict[str, Any]],
    levels_dir: Path,
) -> Dict[str, List[str]]:
    cet4_a, cet6_a, ielts_a = build_exclusive_sets(levels_dir)
    lemmas = lemmas_from_segments(segments)
    ielts = sorted(lemmas & ielts_a)
    cet6 = sorted(lemmas & cet6_a)
    cet4 = sorted(lemmas & cet4_a)
    return {"CET4": cet4, "CET6": cet6, "IELTS": ielts}


def write_vocab_levels(path: Path, obj: Dict[str, Any]) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def vocabulary_levels_hard_only_document(lemmas: List[str]) -> Dict[str, Any]:
    """
    粘贴生词表 →「②」写入 *_vocabulary_levels.json 时使用的**唯一**结构：
    仅 `version` + `hard`（规范化后的 lemma 列表）。

    **禁止**写入中文、音标、`_packager_meta` 等；释义在 *_vocab_paste_meta.json（本机③）
    与 *_vocab_display.json（网页点词）。
    """
    return {"version": 1, "hard": list(lemmas)}


def write_vocabulary_levels_hard_only(path: Path, lemmas: List[str]) -> None:
    """写入供网页识别难词（紫下划线）的 sidecar；文件内不含任何释义字段。"""
    write_vocab_levels(path, vocabulary_levels_hard_only_document(lemmas))
