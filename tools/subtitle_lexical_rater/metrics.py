# -*- coding: utf-8 -*-

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, List, Sequence

from bilingual_packager.srt_parse import SrtCue

_WORD_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_WS_RE = re.compile(r"\s+")

# A small stoplist to avoid flooding candidates with function words.
_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "he",
    "her",
    "him",
    "his",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "just",
    "me",
    "my",
    "no",
    "not",
    "of",
    "on",
    "or",
    "our",
    "out",
    "she",
    "so",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "to",
    "up",
    "us",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "who",
    "will",
    "with",
    "would",
    "you",
    "your",
}


def cues_to_plain_english(cues: Sequence[SrtCue]) -> str:
    # Keep as much lexical content as possible; strip obvious formatting.
    parts: List[str] = []
    for c in cues:
        t = c.text
        # remove html tags like <i>...</i>
        t = re.sub(r"<[^>]+>", " ", t)
        t = t.replace("\u200b", " ")
        t = t.replace("—", " ").replace("–", " ")
        t = t.replace("[", " ").replace("]", " ")
        t = t.replace("(", " ").replace(")", " ")
        t = t.replace("{", " ").replace("}", " ")
        t = t.replace("|", " ")
        t = _WS_RE.sub(" ", t).strip()
        if t:
            parts.append(t)
    return "\n".join(parts)


def tokenize_words(text: str) -> List[str]:
    return [m.group(0).lower() for m in _WORD_RE.finditer(text)]


@dataclass(frozen=True)
class LocalMetrics:
    cue_count: int
    duration_seconds: float
    total_words: int
    unique_types: int
    avg_word_len: float
    long_word_ratio: float
    type_token_ratio: float
    wpm: float
    candidate_hard_words: List[str]


def _duration_seconds(cues: Sequence[SrtCue]) -> float:
    if not cues:
        return 0.0
    start = min(c.start for c in cues)
    end = max(c.end for c in cues)
    return max(0.0, float(end) - float(start))


def _avg_word_len(words: Sequence[str]) -> float:
    if not words:
        return 0.0
    return sum(len(w) for w in words) / len(words)


def _long_word_ratio(words: Sequence[str], *, min_len: int = 9) -> float:
    if not words:
        return 0.0
    long_n = sum(1 for w in words if len(w) >= min_len)
    return long_n / len(words)


def _type_token_ratio(words: Sequence[str]) -> float:
    if not words:
        return 0.0
    return len(set(words)) / len(words)


def _pick_candidates(words: Sequence[str], counts: Counter[str], *, limit: int = 60) -> List[str]:
    uniq = []
    seen = set()
    for w in words:
        if w in seen:
            continue
        seen.add(w)
        if w in _STOPWORDS:
            continue
        if len(w) <= 2:
            continue
        uniq.append(w)

    def score(w: str) -> tuple[int, int, str]:
        # heuristic: prefer low frequency + long length
        return (counts[w], -len(w), w)

    ranked = sorted(uniq, key=score)
    return ranked[:limit]


def compute_local_metrics(cues: Sequence[SrtCue]) -> LocalMetrics:
    txt = cues_to_plain_english(cues)
    words = tokenize_words(txt)
    counts = Counter(words)
    dur = _duration_seconds(cues)
    minutes = max(1e-9, dur / 60.0)
    wpm = len(words) / minutes if dur > 0 else 0.0
    candidates = _pick_candidates(words, counts)

    return LocalMetrics(
        cue_count=len(cues),
        duration_seconds=dur,
        total_words=len(words),
        unique_types=len(set(words)),
        avg_word_len=_avg_word_len(words),
        long_word_ratio=_long_word_ratio(words),
        type_token_ratio=_type_token_ratio(words),
        wpm=wpm,
        candidate_hard_words=candidates,
    )

