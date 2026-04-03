# -*- coding: utf-8 -*-
"""Parse a single SubRip file into cues."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import List


_TS = re.compile(
    r"^(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})"
)


def _ts_to_seconds(ts: str) -> float:
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    return float(parts[0])


@dataclass
class SrtCue:
    start: float
    end: float
    text: str


def parse_srt_file(path: Path) -> List[SrtCue]:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    if text.startswith("\ufeff"):
        text = text[1:]
    blocks = re.split(r"\n\s*\n", text.strip())
    cues: List[SrtCue] = []
    for block in blocks:
        lines = [ln.rstrip() for ln in block.strip().split("\n")]
        lines = [ln for ln in lines if ln != ""]
        if len(lines) < 2:
            continue
        li = 0
        if lines[0].strip().isdigit():
            li = 1
        if li >= len(lines):
            continue
        m = _TS.match(lines[li].strip())
        if not m:
            continue
        start = _ts_to_seconds(m.group(1))
        end = _ts_to_seconds(m.group(2))
        li += 1
        body = "\n".join(lines[li:]).strip()
        if not body or end <= start:
            continue
        cues.append(SrtCue(start=float(start), end=float(end), text=body))
    return cues


def pair_en_zh_by_index(
    en_cues: List[SrtCue],
    zh_cues: List[SrtCue],
    *,
    max_time_skew: float = 0.25,
) -> List[tuple[SrtCue, SrtCue]]:
    if len(en_cues) != len(zh_cues):
        raise ValueError(f"SRT 条数不一致：英文 {len(en_cues)}，中文 {len(zh_cues)}")
    out: List[tuple[SrtCue, SrtCue]] = []
    for i, (e, z) in enumerate(zip(en_cues, zh_cues, strict=True)):
        if abs(e.start - z.start) > max_time_skew or abs(e.end - z.end) > max_time_skew:
            raise ValueError(
                f"第 {i + 1} 条时间轴不一致：EN [{e.start:.3f}-{e.end:.3f}] "
                f"vs ZH [{z.start:.3f}-{z.end:.3f}]（允许偏差 {max_time_skew}s）"
            )
        out.append((e, z))
    return out
