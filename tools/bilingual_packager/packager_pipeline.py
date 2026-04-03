# -*- coding: utf-8 -*-
"""High-level steps: main JSON, vocabulary levels."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .merge_sonix_words import apply_sonix_csv_to_doc
from .srt_parse import pair_en_zh_by_index, parse_srt_file
from .vocab_levels import build_vocabulary_levels_json, write_vocab_levels

LogFn = Optional[Callable[[str], None]]


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_main_subtitle_json(
    *,
    en_srt: Path,
    zh_srt: Path,
    output_dir: Path,
    output_prefix: str,
    sonix_csv: Optional[Path] = None,
    logger: LogFn = None,
) -> Path:
    """
    Pair EN/ZH SRT by index, optionally merge Sonix word-level CSV into words[].
    Without Sonix CSV, words[] are empty (phrase UI needs words later via merge script or re-run with CSV).
    """
    log = logger or (lambda _m: None)
    en_cues = parse_srt_file(en_srt)
    zh_cues = parse_srt_file(zh_srt)
    pairs = pair_en_zh_by_index(en_cues, zh_cues)
    cues: List[Dict[str, Any]] = [
        {"start": e.start, "end": e.end, "text": e.text} for e, _z in pairs
    ]
    n_cues = len(cues)
    if n_cues:
        sub_first = min(float(c["start"]) for c in cues)
        sub_last = max(float(c["end"]) for c in cues)
    else:
        sub_first = sub_last = 0.0
    log(f"字幕共 {n_cues} 条，时间范围约 {sub_first:.2f}s – {sub_last:.2f}s。")

    output_dir.mkdir(parents=True, exist_ok=True)

    segments: List[Dict[str, Any]] = []
    for e, z in pairs:
        segments.append(
            {
                "start": e.start,
                "end": e.end,
                "en_text": e.text,
                "zh_text": z.text,
                "words": [],
                "phrases": [],
            }
        )

    word_align = "none"
    if sonix_csv and sonix_csv.is_file():
        log(f"合并词级时间轴：{sonix_csv}")
        doc_pre: Dict[str, Any] = {"meta": {}, "segments": segments}
        try:
            ok_n, bad_n = apply_sonix_csv_to_doc(doc_pre, sonix_csv)
            log(f"词级合并完成：有 words 的条数={ok_n}，清空（不一致/空）={bad_n}。")
            word_align = "sonix_csv"
        except Exception as e:
            log(f"词级 CSV 合并失败（已生成句级 JSON，words[] 为空）：{e}")
            word_align = "none"
            for seg in segments:
                seg["words"] = []
    else:
        if sonix_csv:
            log(f"未找到词级 CSV 文件（已忽略）：{sonix_csv}")
        else:
            log("未提供 Sonix CSV：words[] 为空。可稍后运行 merge_sonix_words.py 或在本界面填写 CSV 后重新点①。")

    meta: Dict[str, Any] = {
        "source_url": "",
        "video_id": output_prefix,
        "generated_at": _iso_now(),
        "language": "en",
        "model": "",
        "pipeline": "bilingual_packager",
        "srt_en": str(en_srt.resolve()),
        "srt_zh": str(zh_srt.resolve()),
        "media_path": None,
        "word_align": word_align,
        "subtitle_cue_count": n_cues,
        "subtitle_span_sec": {"start": sub_first, "end": sub_last},
        "media_duration_sec": None,
    }
    if word_align == "sonix_csv" and sonix_csv and sonix_csv.is_file():
        meta["sonix_csv"] = str(sonix_csv.resolve())

    doc = {"meta": meta, "segments": segments}
    out_path = output_dir / f"{output_prefix}.json"
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"已写入 {out_path}")
    return out_path


def build_levels_file(
    *,
    subtitle_json: Path,
    levels_dir: Path,
    output_dir: Path,
    output_prefix: str,
    logger: LogFn = None,
) -> Path:
    log = logger or (lambda _m: None)
    doc = json.loads(subtitle_json.read_text(encoding="utf-8"))
    segments = doc.get("segments") or []
    if not isinstance(segments, list):
        raise ValueError("segments 无效")
    obj = build_vocabulary_levels_json(segments, levels_dir)
    out_path = output_dir / f"{output_prefix}_vocabulary_levels.json"
    write_vocab_levels(out_path, obj)
    n = sum(len(obj.get(k, [])) for k in ("CET4", "CET6", "IELTS"))
    log(f"已写入 {out_path}（共约 {n} 个词形条目）")
    if n == 0:
        log(
            "提示：三级词表均为空时，请检查主 JSON 各句是否至少有 en_text；"
            "若曾跳过词级 CSV 未生成 words[]，现在也会从整句英文抽词，仍为空则可能是字幕与 levels 词表无交集。"
        )
    return out_path


def load_subtitle_doc(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def save_subtitle_doc(path: Path, doc: Dict[str, Any]) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
