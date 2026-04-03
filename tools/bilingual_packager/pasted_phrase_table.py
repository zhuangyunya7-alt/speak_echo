# -*- coding: utf-8 -*-
"""Parse pasted phrase tables: 序号/词组/中文翻译/语境参考 (Tab or multi-space separated)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Tuple


@dataclass
class PastedPhraseRow:
    phrase: str
    zh: str
    context: str


def _is_header_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    # Typical header: 序号\t词组\t中文翻译\t语境参考
    return ("词组" in s and "中文" in s) or s.startswith("序号")


def _split_row(line: str) -> List[str]:
    if "\t" in line:
        return [p.strip() for p in line.split("\t")]
    return [p.strip() for p in re.split(r"\s{2,}", line.strip()) if p.strip()]


def parse_pasted_phrase_table(text: str) -> Tuple[List[PastedPhraseRow], List[str]]:
    """
    Returns rows + warnings (non-fatal). De-duplicates by (phrase.lower(), zh).
    """
    warnings: List[str] = []
    seen: set[tuple[str, str]] = set()
    rows: List[PastedPhraseRow] = []
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
        i0 = 0
        if parts[0].isdigit() and len(parts) >= 3:
            i0 = 1
        phrase = (parts[i0] if len(parts) > i0 else "").strip()
        zh = (parts[i0 + 1] if len(parts) > i0 + 1 else "").strip()
        context = (parts[i0 + 2] if len(parts) > i0 + 2 else "").strip()
        if not phrase:
            warnings.append(f"跳过（无词组）: {line[:60]}")
            continue
        k = (phrase.lower(), zh)
        if k in seen:
            continue
        seen.add(k)
        rows.append(PastedPhraseRow(phrase=phrase, zh=zh, context=context))
    return rows, warnings

