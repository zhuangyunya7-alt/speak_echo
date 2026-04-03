# -*- coding: utf-8 -*-
"""Standalone phrase extractor package."""

from .extractor import ExtractionResult, extract_candidates
from .strategies import StrategyConfig, apply_strategy_overrides, get_strategy

__all__ = [
    "ExtractionResult",
    "StrategyConfig",
    "apply_strategy_overrides",
    "extract_candidates",
    "get_strategy",
]

