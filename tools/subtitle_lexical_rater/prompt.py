# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from typing import Any, Dict, List


def build_prompt(*, local: Dict[str, Any]) -> List[Dict[str, str]]:
    """
    Construct OpenAI-style chat messages. We force strict JSON output via prompt.
    The model should not bind to CET/IELTS wordlists; focus on real usage difficulty.
    """
    rubric = (
        "你是英语字幕词汇难度评估器。根据输入的本地统计指标与候选难词样本，"
        "输出该字幕整体英语词汇难度的 1~5 星评级，并给出可解释的子分与难词例子。\n\n"
        "评分标准（只评英语词汇难度，不评内容敏感性）：\n"
        "- 1星：非常日常、口语为主；几乎无专业/书面低频词；长词少；WPM 适中。\n"
        "- 2星：日常为主，少量书面/正式词；偶尔出现稍难词但不密集。\n"
        "- 3星：明显包含较多书面词、抽象词、较长词；或出现一定比例的低频词；理解需要一定词汇量。\n"
        "- 4星：专业/学术/法律/科技/金融等领域词较多；低频与长词密集；或表达偏书面复杂。\n"
        "- 5星：高度专业或学术化；大量低频术语、派生词、复合词；一般学习者难以顺畅理解。\n\n"
        "要求：\n"
        "1) 只输出 JSON，不要输出任何额外文本。\n"
        "2) stars_1_5 必须是 1~5 的整数。\n"
        "3) subscores.lexical/length/wpm 均为 0~100 的整数（用于后续调参）。\n"
        "4) difficult_words 给出 8~20 个你认为代表性的难词（小写即可）。\n"
        "5) rationale_zh 用中文 2~4 句说明理由。\n\n"
        "输出 JSON schema:\n"
        "{\n"
        '  "raw_score": number,\n'
        '  "stars_1_5": 1|2|3|4|5,\n'
        '  "subscores": { "lexical": int, "length": int, "wpm": int },\n'
        '  "rationale_zh": string,\n'
        '  "difficult_words": [string, ...]\n'
        "}\n"
    )

    user_payload = {
        "task": "rate_subtitle_lexical_difficulty",
        "local_metrics": local,
        "notes": {
            "candidate_hard_words": "These are heuristically selected, not authoritative. Use as hints only."
        },
    }

    return [
        {"role": "system", "content": rubric},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False, indent=2)},
    ]

