# -*- coding: utf-8 -*-
"""Parse pasted 序号/单词/音标/中文/语境 tables (tab or whitespace separated)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from .vocab_levels import normalize_lemma


@dataclass
class PastedVocabRow:
    """One row from user paste."""

    word_surface: str
    ipa: str
    zh: str
    context: str
    lemma: str


def _is_header_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if "单词" in s and ("音标" in s or "中文" in s):
        return True
    if s.startswith("序号") and "\t" in s:
        return True
    return False


def _split_row(line: str) -> List[str]:
    if "\t" in line:
        return [p.strip() for p in line.split("\t")]
    # Multiple spaces between columns (best-effort)
    return [p.strip() for p in re.split(r"\s{2,}", line.strip()) if p.strip()]


def parse_pasted_vocab_table(text: str) -> Tuple[List[PastedVocabRow], List[str]]:
    """
    Returns ordered rows + parse warnings (non-fatal).
    Skips empty lines and header; de-duplicates by normalized lemma (keeps first).
    """
    warnings: List[str] = []
    seen: set[str] = set()
    rows: List[PastedVocabRow] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if _is_header_line(line):
            continue
        parts = _split_row(raw)
        if len(parts) < 2:
            warnings.append(f"跳过（列太少）: {line[:60]}")
            continue
        # Optional leading index column
        i0 = 0
        if parts[0].isdigit() and len(parts) >= 4:
            i0 = 1
        if len(parts) - i0 < 2:
            warnings.append(f"跳过: {line[:60]}")
            continue
        word = (parts[i0] or "").strip()
        if not word:
            warnings.append(f"跳过（无单词）: {line[:60]}")
            continue
        ipa = (parts[i0 + 1] if len(parts) > i0 + 1 else "").strip()
        zh = (parts[i0 + 2] if len(parts) > i0 + 2 else "").strip()
        context = (parts[i0 + 3] if len(parts) > i0 + 3 else "").strip()
        lemma = normalize_lemma(word)
        if not lemma:
            warnings.append(f"跳过（无法规范化词形）: {word}")
            continue
        if lemma in seen:
            continue
        seen.add(lemma)
        rows.append(
            PastedVocabRow(
                word_surface=word.strip(),
                ipa=ipa.strip(),
                zh=zh.strip(),
                context=context.strip(),
                lemma=lemma,
            )
        )
    return rows, warnings


def lemmas_in_order(rows: List[PastedVocabRow]) -> List[str]:
    return [r.lemma for r in rows]


def vocab_paste_sidecar_document(rows: List[PastedVocabRow]) -> Dict[str, Any]:
    """本机侧车：生成 ③ vocab_display 时使用；勿上传到 COS。"""
    by_lemma: Dict[str, Any] = {}
    for r in rows:
        by_lemma[r.lemma] = {
            "word": r.word_surface,
            "ipa": r.ipa,
            "zh": r.zh,
            "context": r.context,
        }
    return {"version": 1, "by_lemma": by_lemma}
