# -*- coding: utf-8 -*-
"""Core phrase extraction logic for offline experiments."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

try:
    from tools.bilingual_packager.phrase_utils import try_make_phrase_entry
except ModuleNotFoundError:
    from bilingual_packager.phrase_utils import try_make_phrase_entry

from .strategies import StrategyConfig

Logger = Callable[[str], None]

_WS_RE = re.compile(r"\s+")
_WORD_RE = re.compile(r"[A-Za-z']+")

_SIMPLE_STOP_PHRASES = {
    "go to",
    "look at",
    "want to",
    "need to",
    "have to",
    "be in",
    "be on",
    "be at",
    "get to",
    "come to",
    "go on",
    "go back",
    "in the",
    "of the",
}

_HIGH_FREQ_WORDS = {
    "the",
    "a",
    "an",
    "to",
    "in",
    "on",
    "of",
    "for",
    "and",
    "or",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "do",
    "does",
    "did",
    "go",
    "look",
    "make",
    "take",
    "get",
    "have",
}

_BUSINESS_LEXICON = {
    "scale",
    "growth",
    "margin",
    "revenue",
    "profit",
    "pipeline",
    "client",
    "customer",
    "lead",
    "pricing",
    "offer",
    "sales",
    "market",
    "headroom",
    "side hustle",
    "pain point",
    "traction",
    "conversion",
    "brand",
    "positioning",
    "negotiate",
    "strategy",
    "leverage",
    "upside",
    "downside",
    "risk",
}

_DISCOURSE_PHRASES = {
    "to be fair",
    "on the flip side",
    "long story short",
    "to be honest",
    "at the end of the day",
    "in other words",
    "that said",
    "essentially",
}

_VERB_PARTICLE_PATTERNS = {
    "scale up",
    "scale down",
    "figure out",
    "tap into",
    "reach out",
    "double down",
    "follow up",
    "break down",
    "roll out",
    "phase out",
    "lean into",
    "opt in",
    "opt out",
    "build out",
    "set up",
    "line up",
}


@dataclass
class ExtractionResult:
    items: List[Dict[str, Any]]
    stats: Dict[str, int]


def _norm_ws(s: str) -> str:
    return _WS_RE.sub(" ", (s or "").strip())


def _norm_key(s: str) -> str:
    return _norm_ws(s).lower()


def _word_count(s: str) -> int:
    return len(_WORD_RE.findall(s))


def _safe_words(seg: Dict[str, Any]) -> List[Dict[str, Any]]:
    words = seg.get("words")
    return words if isinstance(words, list) else []


def _spacy_nlp():
    try:
        import spacy  # type: ignore

        for model in ("en_core_web_sm", "en_core_web_md", "en_core_web_trf"):
            try:
                return spacy.load(model)
            except Exception:
                continue
    except Exception:
        return None
    return None


def _extract_with_spacy(en_text: str, nlp: Any) -> Iterable[str]:
    doc = nlp(en_text)
    out: List[str] = []
    for i in range(len(doc) - 1):
        a = doc[i]
        b = doc[i + 1]
        if a.pos_ in {"VERB", "AUX"} and b.pos_ in {"ADP", "PART"}:
            out.append(f"{a.text} {b.text}")
    low = en_text.lower()
    for p in _DISCOURSE_PHRASES:
        idx = low.find(p)
        if idx >= 0:
            out.append(en_text[idx : idx + len(p)])
    return out


def _extract_with_rules(en_text: str) -> Iterable[str]:
    low = _norm_key(en_text)
    words = _WORD_RE.findall(low)
    out: List[str] = []
    for p in (_VERB_PARTICLE_PATTERNS | _DISCOURSE_PHRASES | _BUSINESS_LEXICON):
        if " " in p and p in low:
            out.append(p)
    preps_parts = {"up", "down", "out", "into", "over", "off", "on", "through", "across", "by"}
    for i in range(len(words) - 1):
        a, b = words[i], words[i + 1]
        if b in preps_parts and len(a) >= 3 and a not in _HIGH_FREQ_WORDS:
            out.append(f"{a} {b}")
    return out


def _phrase_score(phrase: str, *, business_boost: bool) -> int:
    p = _norm_key(phrase)
    score = 0
    if p in _VERB_PARTICLE_PATTERNS:
        score += 5
    if p in _DISCOURSE_PHRASES:
        score += 6
    if business_boost:
        if p in _BUSINESS_LEXICON:
            score += 8
        for t in _BUSINESS_LEXICON:
            if " " not in t and t in p:
                score += 2
    wc = _word_count(p)
    if 2 <= wc <= 5:
        score += 2
    return score


def _is_low_value(phrase: str, *, min_words: int) -> bool:
    p = _norm_key(phrase)
    if not p:
        return True
    if _word_count(p) < min_words:
        return True
    if p in _SIMPLE_STOP_PHRASES:
        return True
    parts = _WORD_RE.findall(p)
    if parts and all(w in _HIGH_FREQ_WORDS for w in parts):
        return True
    return False


def extract_candidates(
    segments: Sequence[Dict[str, Any]],
    *,
    strategy: StrategyConfig,
    display_en_lines: Sequence[str] | None = None,
    logger: Logger | None = None,
) -> ExtractionResult:
    log = logger or (lambda _m: None)
    nlp = _spacy_nlp()
    if nlp is None:
        log("phrase_extractor: spaCy unavailable, fallback rules mode.")
    else:
        log("phrase_extractor: spaCy model loaded.")

    staged: List[Dict[str, Any]] = []
    seen: set[Tuple[int, int, int, str]] = set()
    total_raw = 0
    total_deduped = 0
    total_filtered = 0
    total_aligned = 0

    for i, seg in enumerate(segments):
        words = _safe_words(seg)
        if not words:
            continue
        line = ""
        if display_en_lines and i < len(display_en_lines):
            line = display_en_lines[i]
        if not line:
            line = (seg.get("en_text") or seg.get("text") or "")
        line = _norm_ws(line)
        if not line:
            continue

        raw_candidates: List[str] = []
        if nlp is not None:
            raw_candidates.extend(_extract_with_spacy(line, nlp))
        raw_candidates.extend(_extract_with_rules(line))
        total_raw += len(raw_candidates)

        uniq = {_norm_key(p): _norm_ws(p) for p in raw_candidates if _norm_key(p)}
        total_deduped += len(uniq)
        scored: List[Tuple[int, str]] = []
        for phrase in uniq.values():
            if _is_low_value(phrase, min_words=strategy.min_words):
                total_filtered += 1
                continue
            score = _phrase_score(phrase, business_boost=strategy.business_boost)
            if score < strategy.min_score:
                total_filtered += 1
                continue
            scored.append((score, phrase))

        scored.sort(key=lambda x: (-x[0], len(x[1])))
        accepted_in_sentence = 0
        for score, phrase in scored:
            entry = try_make_phrase_entry(
                seg,
                phrase,
                reason="自动提取候选",
                zh=None,
                display_en_text=line,
                char_hint=None,
            )
            if not entry:
                continue
            key = (i, int(entry["wStart"]), int(entry["wEnd"]), _norm_key(entry["text"]))
            if key in seen:
                continue
            seen.add(key)
            staged.append(
                {
                    "segment_index": i,
                    "score": score,
                    "strategy": strategy.name,
                    **entry,
                }
            )
            total_aligned += 1
            accepted_in_sentence += 1
            if accepted_in_sentence >= max(1, int(strategy.max_per_sentence)):
                break

    stats = {
        "sentences": len(segments),
        "raw_candidates": total_raw,
        "deduped_candidates": total_deduped,
        "filtered_out": total_filtered,
        "aligned_added": total_aligned,
    }
    log(
        "phrase_extractor done: "
        f"sentences={stats['sentences']} raw={stats['raw_candidates']} "
        f"deduped={stats['deduped_candidates']} "
        f"filtered={stats['filtered_out']} aligned={stats['aligned_added']}"
    )
    return ExtractionResult(items=staged, stats=stats)

