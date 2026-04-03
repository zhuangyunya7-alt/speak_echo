# -*- coding: utf-8 -*-
"""Printable word cards HTML from *_vocab_display.json (lemma, ipa, zh, en gloss)."""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any, Dict


def write_word_cards_html(
    *,
    vocab_display_path: Path,
    out_path: Path,
    title: str = "单词卡片",
) -> None:
    raw = json.loads(vocab_display_path.read_text(encoding="utf-8"))
    entries = raw.get("entries")
    if not isinstance(entries, dict):
        raise ValueError("vocab_display.json 缺少 entries 对象")

    items: list[tuple[str, Dict[str, Any]]] = []
    for k, v in sorted(entries.items(), key=lambda x: str(x[0]).lower()):
        if isinstance(v, dict):
            items.append((str(k), v))

    esc = html.escape
    cards: list[str] = []
    for lemma, e in items:
        ipa = esc(str(e.get("ipa") or "").strip())
        zh = esc(str(e.get("zh") or "").strip())
        pos = esc(str(e.get("pos") or "").strip())
        endef = esc(str(e.get("en_definition") or "").strip())
        lvl = esc(str(e.get("level") or "").strip())
        w = esc(lemma)
        pos_line = f'<div class="pos">{pos}</div>' if pos else ""
        def_line = f'<div class="endef">{endef}</div>' if endef else ""
        lvl_line = f'<span class="tag">{lvl}</span>' if lvl else ""
        cards.append(
            f"""<article class="card">
  <header><span class="word">{w}</span>{lvl_line}</header>
  <div class="ipa">{ipa or "—"}</div>
  <div class="zh">{zh or "—"}</div>
  {pos_line}
  {def_line}
</article>"""
        )

    body = "\n".join(cards)
    doc = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{esc(title)}</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      margin: 0; padding: 1.25rem; background: #f4f4f5; color: #18181b;
    }}
    h1 {{ font-size: 1.25rem; margin: 0 0 1rem; font-weight: 600; }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
    }}
    .card {{
      background: #fff; border-radius: 12px; padding: 1rem 1.1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,.08); border: 1px solid #e4e4e7;
      break-inside: avoid;
    }}
    .card header {{ display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; margin-bottom: .35rem; }}
    .word {{ font-size: 1.35rem; font-weight: 700; letter-spacing: .02em; }}
    .tag {{ font-size: .7rem; text-transform: uppercase; color: #71717a; }}
    .ipa {{ font-size: .95rem; color: #52525b; margin-bottom: .5rem; font-family: ui-serif, Georgia, serif; }}
    .zh {{ font-size: 1.05rem; line-height: 1.45; color: #27272a; margin-bottom: .35rem; }}
    .pos {{ font-size: .8rem; color: #71717a; margin-bottom: .25rem; }}
    .endef {{ font-size: .82rem; color: #3f3f46; line-height: 1.4; }}
    @media print {{
      body {{ background: #fff; padding: .5rem; }}
      .card {{ box-shadow: none; border: 1px solid #d4d4d8; }}
    }}
  </style>
</head>
<body>
  <h1>{esc(title)} <small style="font-weight:400;color:#71717a">（共 {len(items)} 词）</small></h1>
  <div class="grid">
{body}
  </div>
</body>
</html>
"""
    out_path.write_text(doc, encoding="utf-8")
