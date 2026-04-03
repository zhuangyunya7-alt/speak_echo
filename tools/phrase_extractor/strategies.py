# -*- coding: utf-8 -*-
"""Strategy presets for phrase extraction."""

from __future__ import annotations

from dataclasses import dataclass, replace


@dataclass(frozen=True)
class StrategyConfig:
    name: str
    max_per_sentence: int
    min_words: int
    business_boost: bool
    min_score: int


STRATEGIES = {
    "aggressive": StrategyConfig(
        name="aggressive",
        max_per_sentence=6,
        min_words=2,
        business_boost=True,
        min_score=2,
    ),
    "balanced": StrategyConfig(
        name="balanced",
        max_per_sentence=3,
        min_words=2,
        business_boost=True,
        min_score=5,
    ),
    "conservative": StrategyConfig(
        name="conservative",
        max_per_sentence=2,
        min_words=3,
        business_boost=True,
        min_score=8,
    ),
}


def get_strategy(name: str) -> StrategyConfig:
    key = (name or "balanced").strip().lower()
    if key not in STRATEGIES:
        raise ValueError(f"Unknown strategy: {name}")
    return STRATEGIES[key]


def apply_strategy_overrides(
    cfg: StrategyConfig,
    *,
    max_per_sentence: int | None = None,
    min_words: int | None = None,
    business_boost: bool | None = None,
    min_score: int | None = None,
) -> StrategyConfig:
    """Return a new config with only the provided fields replaced (CLI overrides)."""
    patch: dict[str, object] = {}
    if max_per_sentence is not None:
        patch["max_per_sentence"] = max(1, int(max_per_sentence))
    if min_words is not None:
        patch["min_words"] = max(1, int(min_words))
    if business_boost is not None:
        patch["business_boost"] = bool(business_boost)
    if min_score is not None:
        patch["min_score"] = int(min_score)
    if not patch:
        return cfg
    return replace(cfg, name=f"{cfg.name}+override", **patch)

