# -*- coding: utf-8 -*-
"""Build {prefix}_vocab_display.json using free dictionary API + Tencent Hunyuan for contextual zh."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .vocab_levels import normalize_lemma

LogFn = Optional[Callable[[str], None]]
ProgressFn = Optional[Callable[[int, int, str], None]]


def sidecar_paste_meta_path(vocabulary_levels_path: Path) -> Path:
    """与 *_vocabulary_levels.json 同前缀的粘贴释义侧车路径（仅打包工具使用）。"""
    stem = vocabulary_levels_path.stem
    if stem.endswith("_vocabulary_levels"):
        base = stem[: -len("_vocabulary_levels")]
        return vocabulary_levels_path.parent / f"{base}_vocab_paste_meta.json"
    return vocabulary_levels_path.parent / f"{stem}_vocab_paste_meta.json"


def resolve_packager_meta(vocabulary_levels_path: Path, levels_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    释义/音标来源：优先 levels 内嵌 _packager_meta（旧版），否则读 *_vocab_paste_meta.json。
    网页不读这些字段；仅用于本工具生成 *_vocab_display.json。
    """
    meta = levels_data.get("_packager_meta")
    if isinstance(meta, dict) and meta:
        return meta
    sidecar = sidecar_paste_meta_path(vocabulary_levels_path)
    if sidecar.is_file():
        raw = json.loads(sidecar.read_text(encoding="utf-8"))
        bl = raw.get("by_lemma")
        if isinstance(bl, dict) and bl:
            return bl
    return {}


def build_hunyuan_client(secret_id: str, secret_key: str, region: str) -> Any:
    from tencentcloud.common import credential
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
    from tencentcloud.hunyuan.v20230901 import hunyuan_client

    cred = credential.Credential(secret_id.strip(), secret_key.strip())
    http_profile = HttpProfile()
    http_profile.endpoint = "hunyuan.tencentcloudapi.com"
    client_profile = ClientProfile()
    client_profile.httpProfile = http_profile
    return hunyuan_client.HunyuanClient(cred, region.strip() or "ap-shanghai", client_profile)


def fetch_dictionary_free(lemma: str) -> Dict[str, str]:
    url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{urllib.parse.quote(lemma, safe='')}"
    req = urllib.request.Request(url, headers={"User-Agent": "SpeakEcho-bilingual_packager/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return {}
    if not isinstance(data, list) or not data:
        return {}
    first = data[0]
    if not isinstance(first, dict):
        return {}
    ipa = ""
    for p in first.get("phonetics") or []:
        if isinstance(p, dict):
            t = (p.get("text") or "").strip()
            if t:
                ipa = t
                break
    pos = ""
    definition = ""
    meanings = first.get("meanings") or []
    if isinstance(meanings, list) and meanings:
        m0 = meanings[0]
        if isinstance(m0, dict):
            pos = (m0.get("partOfSpeech") or "").strip()
            defs = m0.get("definitions") or []
            if isinstance(defs, list) and defs and isinstance(defs[0], dict):
                definition = (defs[0].get("definition") or "").strip()
    return {"ipa": ipa, "pos": pos, "en_definition": definition}


def _extract_json_object(text: str) -> Dict[str, Any]:
    t = text.strip()
    if t.startswith("```"):
        lines = t.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        t = "\n".join(lines).strip()
    m = re.search(r"\{[\s\S]*\}", t)
    if not m:
        raise ValueError("No JSON object in model output")
    return json.loads(m.group(0))


def hunyuan_contextual_gloss(
    client: Any,
    *,
    lemma: str,
    en_sentence: str,
    zh_sentence: str,
    base_en_def: str,
    model: str = "hunyuan-turbos-latest",
) -> Tuple[str, str, str]:
    from tencentcloud.hunyuan.v20230901 import models

    sys_m = models.Message()
    sys_m.Role = "system"
    sys_m.Content = (
        "你是英语学习词典编辑。用户会给出一个英文词、它出现的整句英文、对应中文字幕整句、以及词典里的英文释义。"
        "请只输出一个 JSON 对象，不要 markdown，键为："
        'zh（该词在本句语境下的简短中文释义，必须与整句中文意思一致）, '
        'en_definition（一句英文释义，贴合本句）, '
        'pos（词性，如 noun/verb/adjective）。'
    )
    usr_m = models.Message()
    usr_m.Role = "user"
    usr_m.Content = (
        f"lemma: {lemma}\n"
        f"EN sentence: {en_sentence[:800]}\n"
        f"ZH sentence: {zh_sentence[:800]}\n"
        f"Dictionary gloss (hint): {base_en_def[:500]}\n"
        'Output JSON only, e.g. {"zh":"…","en_definition":"…","pos":"noun"}'
    )
    req = models.ChatCompletionsRequest()
    req.Model = model
    req.Messages = [sys_m, usr_m]
    req.Stream = False
    req.Temperature = 0.2
    resp = client.ChatCompletions(req)
    if not resp.Choices:
        raise RuntimeError("Hunyuan: empty choices")
    msg = resp.Choices[0].Message
    if msg is None or not (msg.Content or "").strip():
        raise RuntimeError("Hunyuan: empty message")
    obj = _extract_json_object(msg.Content)
    zh = str(obj.get("zh") or "").strip()
    endef = str(obj.get("en_definition") or "").strip()
    pos = str(obj.get("pos") or "").strip()
    return zh, endef, pos


def all_lemmas_from_vocab_levels(vocab_levels: Dict[str, Any]) -> List[str]:
    """粘贴 hard / 分级 IELTS → CET6 → CET4 顺序，按规范词形去重（与树形列表一致）。"""
    seen: set[str] = set()
    out: List[str] = []
    for key in ("hard", "words", "hard_words", "难词", "IELTS", "CET6", "CET4"):
        arr = vocab_levels.get(key) or []
        if not isinstance(arr, list):
            continue
        for x in arr:
            if not isinstance(x, str):
                continue
            lem = normalize_lemma(x.strip())
            if not lem or lem in seen:
                continue
            seen.add(lem)
            out.append(lem)
    return out


def level_for_lemma(lemma: str, vocab_levels: Dict[str, Any]) -> Optional[str]:
    lem = normalize_lemma(lemma)
    for key, tag in (("IELTS", "ielts"), ("CET6", "cet6"), ("CET4", "cet4")):
        arr = vocab_levels.get(key) or vocab_levels.get(key.upper()) or []
        if not isinstance(arr, list):
            continue
        for x in arr:
            if isinstance(x, str) and normalize_lemma(x) == lem:
                return tag
    for key, tag in (("hard", "hard"), ("words", "hard"), ("hard_words", "hard"), ("难词", "hard")):
        arr = vocab_levels.get(key) or []
        if not isinstance(arr, list):
            continue
        for x in arr:
            if isinstance(x, str) and normalize_lemma(x) == lem:
                return tag
    return None


def first_context_for_lemma(
    segments: List[Dict[str, Any]], lemma: str
) -> Tuple[str, str]:
    lem = normalize_lemma(lemma)
    for seg in segments:
        en = (seg.get("en_text") or "").strip()
        zh = (seg.get("zh_text") or "").strip()
        for wt in seg.get("words") or []:
            if not isinstance(wt, dict):
                continue
            w = (wt.get("word") or "").strip()
            if normalize_lemma(w) == lem:
                return en, zh
        toks = re.findall(r"[A-Za-z']+", en)
        for t in toks:
            if normalize_lemma(t) == lem:
                return en, zh
    return "", ""


def build_vocab_display_file(
    *,
    subtitle_path: Path,
    vocab_levels_path: Path,
    out_path: Path,
    selected_lemmas: List[str],
    secret_id: str,
    secret_key: str,
    region: str = "ap-shanghai",
    hunyuan_model: str = "hunyuan-turbos-latest",
    delay_sec: float = 0.15,
    logger: LogFn = None,
    progress_cb: ProgressFn = None,
    cancel_event: Any = None,
) -> Path:
    log = logger or (lambda _m: None)
    progress = progress_cb or (lambda _done, _total, _lemma: None)
    doc = json.loads(subtitle_path.read_text(encoding="utf-8"))
    segments = doc.get("segments") or []
    if not isinstance(segments, list):
        raise ValueError("Invalid subtitle JSON")
    vdoc = json.loads(vocab_levels_path.read_text(encoding="utf-8"))

    client = build_hunyuan_client(secret_id, secret_key, region)
    entries: Dict[str, Dict[str, Any]] = {}
    total = len(selected_lemmas)
    progress(0, total, "")

    for i, raw_lem in enumerate(selected_lemmas):
        if cancel_event is not None and bool(getattr(cancel_event, "is_set", lambda: False)()):
            log("收到终止请求：停止继续处理新词，准备写出已完成结果。")
            break
        lemma = normalize_lemma(raw_lem)
        if not lemma:
            progress(i + 1, total, "")
            continue
        tag = level_for_lemma(lemma, vdoc)
        if not tag:
            log(f"跳过（不在分级词表中）: {lemma}")
            progress(i + 1, total, lemma)
            continue
        en_s, zh_s = first_context_for_lemma(segments, lemma)
        free = fetch_dictionary_free(lemma)
        base_def = (free.get("en_definition") or "").strip()
        ipa = (free.get("ipa") or "").strip()
        pos0 = (free.get("pos") or "").strip()
        try:
            zh, endef, pos = hunyuan_contextual_gloss(
                client,
                lemma=lemma,
                en_sentence=en_s or lemma,
                zh_sentence=zh_s or "",
                base_en_def=base_def or lemma,
                model=hunyuan_model,
            )
        except Exception as e:
            log(f"Hunyuan 失败 {lemma}: {e}，使用词典兜底")
            zh = ""
            endef = base_def
            pos = pos0
        if not endef:
            endef = base_def
        if not pos:
            pos = pos0
        entries[lemma] = {
            "level": tag,
            "en_definition": endef,
            "zh": zh or "",
            "ipa": ipa or None,
            "pos": pos or None,
        }
        log(f"vocab_display {i + 1}/{len(selected_lemmas)}: {lemma}")
        progress(i + 1, total, lemma)
        if delay_sec > 0:
            time.sleep(delay_sec)

    out = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_subtitle": subtitle_path.name,
        "source_vocab_levels": vocab_levels_path.name,
        "entries": entries,
    }
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"已写入 {out_path}（{len(entries)} 词）")
    return out_path


def build_vocab_display_from_packager_meta(
    *,
    subtitle_path: Path,
    vocab_levels_path: Path,
    out_path: Path,
    selected_lemmas: List[str],
    logger: LogFn = None,
    progress_cb: ProgressFn = None,
    cancel_event: Any = None,
) -> Path:
    """
    Build vocab_display from paste meta（侧车 *_vocab_paste_meta.json 或旧版 levels 内嵌 _packager_meta）。
    No Hunyuan or dictionary API.
    """
    log = logger or (lambda _m: None)
    progress = progress_cb or (lambda _done, _total, _lemma: None)
    vdoc = json.loads(vocab_levels_path.read_text(encoding="utf-8"))
    packager_meta = resolve_packager_meta(vocab_levels_path, vdoc)
    if not packager_meta:
        raise ValueError(
            "找不到粘贴释义数据。请先在本页点「② 生成分级词表 JSON」，或保留与之一同生成的 *_vocab_paste_meta.json。"
        )

    entries: Dict[str, Dict[str, Any]] = {}
    total = len(selected_lemmas)
    progress(0, total, "")

    for i, raw_lem in enumerate(selected_lemmas):
        if cancel_event is not None and bool(getattr(cancel_event, "is_set", lambda: False)()):
            log("收到终止请求：停止继续处理新词，准备写出已完成结果。")
            break
        lemma = normalize_lemma(raw_lem)
        if not lemma:
            progress(i + 1, total, "")
            continue
        tag = level_for_lemma(lemma, vdoc)
        if not tag:
            log(f"跳过（不在当前词表中）: {lemma}")
            progress(i + 1, total, lemma)
            continue
        row = packager_meta.get(lemma)
        if not isinstance(row, dict):
            log(f"跳过（粘贴元数据无此项）: {lemma}")
            progress(i + 1, total, lemma)
            continue
        zh = str(row.get("zh") or "").strip()
        ipa_raw = str(row.get("ipa") or "").strip()
        ipa = ipa_raw or None
        ctx = str(row.get("context") or "").strip()
        endef = ctx if ctx else str(row.get("en_definition") or "").strip()
        entries[lemma] = {
            "level": tag,
            "en_definition": endef or "",
            "zh": zh,
            "ipa": ipa,
            "pos": row.get("pos") if isinstance(row.get("pos"), str) else None,
        }
        log(f"vocab_display（本地） {i + 1}/{total}: {lemma}")
        progress(i + 1, total, lemma)

    out = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_subtitle": subtitle_path.name,
        "source_vocab_levels": vocab_levels_path.name,
        "entries": entries,
    }
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"已写入 {out_path}（{len(entries)} 词，来自粘贴释义/音标）")
    return out_path
