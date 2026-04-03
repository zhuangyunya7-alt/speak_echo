# -*- coding: utf-8 -*-
"""Map user text selection to word indices in segment.words[]."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _norm_ws(s: str) -> str:
    """仅折叠空白，保留大小写（写入 JSON 的 text）。"""
    return re.sub(r"\s+", " ", (s or "").strip())


def _letters_compact(s: str) -> str:
    """去掉标点后按序拼接字母片段，用于 into / in to 等与词级分词对齐。"""
    return "".join(re.findall(r"[A-Za-z']+", (s or "").lower()))


def _word_surface(w: Any) -> str:
    """主 JSON / Web 侧可能用 word、w 或 text 存词面。"""
    if not isinstance(w, dict):
        return ""
    return (w.get("word") or w.get("w") or w.get("text") or "").strip()


def _surfaces_from_words(words: List[Any]) -> List[str]:
    return [_word_surface(w) for w in words]


def _flex_span_in_en_text(
    en_text: str, selected: str, anchor_char: Optional[int] = None
) -> Optional[Tuple[int, int]]:
    """Locate selected text in en_text allowing flexible whitespace between tokens."""
    parts = [p for p in re.split(r"\s+", (selected or "").strip()) if p]
    if not parts:
        return None
    pattern = r"\s*".join(re.escape(p) for p in parts)
    matches = list(re.finditer(pattern, en_text, flags=re.IGNORECASE))
    if not matches:
        return None
    if anchor_char is not None and len(matches) > 1:
        best = min(matches, key=lambda m: abs(m.start() - anchor_char))
        return (best.start(), best.end())
    m = matches[0]
    return (m.start(), m.end())


def _word_char_ranges_in_en(en_text: str, surfaces: List[str]) -> Optional[List[Tuple[int, int]]]:
    """
    Greedy left-to-right: each words[] token's span in en_text (case-insensitive).
    """
    ranges: List[Tuple[int, int]] = []
    pos = 0
    low = en_text.lower()
    for w in surfaces:
        w = w.strip()
        if not w:
            ranges.append((pos, pos))
            continue
        while pos < len(en_text) and en_text[pos].isspace():
            pos += 1
        if pos >= len(en_text):
            return None
        wl = w.lower()
        found = low.find(wl, pos)
        if found < 0:
            found = low.find(wl, max(0, pos - 40))
        if found < 0:
            return None
        ranges.append((found, found + len(w)))
        pos = found + len(w)
    return ranges or None


def _char_span_to_word_span(
    ranges: List[Tuple[int, int]], char_start: int, char_end: int
) -> Optional[Tuple[int, int]]:
    if char_end <= char_start:
        return None
    w_start: Optional[int] = None
    w_end = 0
    for i, (a, b) in enumerate(ranges):
        if b > char_start and a < char_end:
            if w_start is None:
                w_start = i
            w_end = i
    if w_start is None:
        return None
    return (w_start, w_end)


def find_word_span_for_phrase(
    words: List[Dict[str, Any]],
    en_text: str,
    selected: str,
    *,
    char_hint: Optional[int] = None,
) -> Optional[Tuple[int, int]]:
    """
    Return (wStart, wEnd) inclusive indices into words[] for the user's selected substring.
    """
    sel = _norm(selected)
    if not sel or not words:
        return None

    n = len(words)
    surfaces = _surfaces_from_words(words)

    # 1) Exact match on normalized token join
    for i in range(n):
        for j in range(i, n):
            chunk = _norm(" ".join(surfaces[i : j + 1]))
            if chunk and chunk == sel:
                return (i, j)

    # 1b) 字母紧凑匹配：come into ≈ come + in + to（词表拆词）
    sel_c = _letters_compact(selected)
    if len(sel_c) >= 2:
        for i in range(n):
            for j in range(i, n):
                chunk = " ".join(surfaces[i : j + 1])
                if _letters_compact(chunk) == sel_c:
                    return (i, j)

    # 2) Find selection in raw en_text, map chars → word indices
    flex = _flex_span_in_en_text(en_text, selected, anchor_char=char_hint)
    if flex:
        wr = _word_char_ranges_in_en(en_text, surfaces)
        if wr is not None and len(wr) == len(surfaces):
            mapped = _char_span_to_word_span(wr, flex[0], flex[1])
            if mapped is not None:
                return mapped

    # 3) Conservative fuzzy (substring + length guard)
    best: Optional[Tuple[int, int, int]] = None
    for i in range(n):
        for j in range(i, n):
            chunk = _norm(" ".join(surfaces[i : j + 1]))
            if not chunk:
                continue
            if chunk == sel:
                return (i, j)
            if sel in chunk or chunk in sel:
                shorter = min(len(chunk), len(sel))
                longer = max(len(chunk), len(sel))
                if shorter < 4 and longer > shorter * 2:
                    continue
                score = abs(len(chunk) - len(sel))
                if best is None or score < best[0]:
                    best = (score, i, j)

    if best:
        return (best[1], best[2])

    return None


def _span_aligns_with_selection(
    surfaces: List[str], i: int, j: int, selected_raw: str
) -> bool:
    """划选与词块在规范化文本或字母紧凑意义上应一致。"""
    selected_norm = _norm(selected_raw)
    if not selected_norm:
        return False
    chunk = _norm(" ".join(surfaces[i : j + 1]))
    if not chunk:
        return False
    if _letters_compact(" ".join(surfaces[i : j + 1])) == _letters_compact(selected_raw):
        return True
    if chunk == selected_norm or selected_norm in chunk or chunk in selected_norm:
        return True
    a, b = set(selected_norm.split()), set(chunk.split())
    if not a or not b:
        return False
    inter = len(a & b)
    need = max(1, int(0.5 * min(len(a), len(b))))
    return inter >= need


def try_make_phrase_entry(
    segment: Dict[str, Any],
    selected_text: str,
    *,
    reason: str = "学习重点词组",
    zh: Optional[str] = None,
    display_en_text: Optional[str] = None,
    char_hint: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """
    若划选可对齐到 words[]，返回一条 phrase 字典（不写回 segment）。

    display_en_text: 与界面左栏一致的英文行（可能与 segment.en_text 不同，例如用 SRT 补全后）；
    char_hint: 划选起始字符在 display_en_text 或 en_text 中的大致偏移，用于同句内重复短语时选对位置。
    """
    words = segment.get("words") or []
    if not isinstance(words, list) or not words:
        return None
    base_en = (segment.get("en_text") or segment.get("text") or "").strip()
    disp_en = (display_en_text or "").strip()
    sel_norm = _norm(selected_text)
    if not sel_norm:
        return None
    span: Optional[Tuple[int, int]] = None
    if disp_en:
        span = find_word_span_for_phrase(words, disp_en, selected_text, char_hint=char_hint)
    if span is None and base_en and (not disp_en or base_en != disp_en):
        span = find_word_span_for_phrase(
            words,
            base_en,
            selected_text,
            char_hint=None if disp_en else char_hint,
        )
    if span is None:
        return None
    i, j = span
    surfaces = _surfaces_from_words(words)
    if not _span_aligns_with_selection(surfaces, i, j, selected_text):
        return None
    phrase_text = _norm_ws(selected_text)
    if not phrase_text:
        return None
    entry: Dict[str, Any] = {
        "text": phrase_text,
        "reason": reason,
        "wStart": i,
        "wEnd": j,
    }
    z = (zh or "").strip()
    if z:
        entry["zh"] = z
    return entry


def add_phrase_to_segment(
    segment: Dict[str, Any],
    selected_text: str,
    *,
    reason: str = "学习重点词组",
    zh: Optional[str] = None,
) -> bool:
    entry = try_make_phrase_entry(segment, selected_text, reason=reason, zh=zh)
    if not entry:
        return False
    phrases = segment.get("phrases")
    if not isinstance(phrases, list):
        phrases = []
    phrases.append(entry)
    segment["phrases"] = phrases
    return True
