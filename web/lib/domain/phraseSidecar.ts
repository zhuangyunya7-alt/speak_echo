import type { PhraseSpan, SubtitleSegment, WordToken } from "@/lib/domain/types";

export type PhraseSidecarItem = {
  text: string;
  zh?: string | null;
  reason?: string | null;
};

const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

function hasCjk(s: string): boolean {
  return CJK_RE.test(s);
}

/**
 * Heuristic: slash-wrapped transcription (e.g. /ˈvɛtərən/) or strong IPA-like symbols, no CJK.
 * Matches common bilingual_packager exports where IPA was stored in the `zh` field by mistake.
 */
export function looksLikeIpaTranscription(s: string): boolean {
  const t = s.trim();
  if (!t || hasCjk(t)) return false;
  if (/^\/[^/]+\/$/.test(t)) return true;
  return /[əɜɪʊɔʌæðθŋʃʒˈˌːꜜꜛ↑↓]/.test(t);
}

/**
 * Normalize sidecar fields: when `zh` holds IPA and `reason` holds the Chinese gloss, swap them
 * so `zh` is always the user-facing 中文 when possible.
 */
export function normalizePhraseSidecarZhReason(
  zh: string | null | undefined,
  reason: string | null | undefined,
): { zh: string | null; reason: string | null } {
  const z = zh?.trim() ? zh.trim() : null;
  const r = reason?.trim() ? reason.trim() : null;
  if (z && looksLikeIpaTranscription(z) && r && hasCjk(r)) {
    return { zh: r, reason: z };
  }
  return { zh: z, reason: r };
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normWs(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function lettersCompact(s: string): string {
  return (s.match(/[A-Za-z']+/g) ?? []).join("").toLowerCase();
}

function surfaces(words: WordToken[]): string[] {
  return words.map((x) => x.w);
}

/** Locate selected phrase in en_text allowing flexible whitespace between tokens. */
function flexSpanInEnText(
  enText: string,
  selected: string,
): { start: number; end: number } | null {
  const parts = selected.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const pattern = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
  const re = new RegExp(pattern, "i");
  const m = re.exec(enText);
  if (!m || m.index === undefined) return null;
  return { start: m.index, end: m.index + m[0].length };
}

function wordCharRangesInEn(enText: string, surfacesList: string[]): [number, number][] | null {
  const ranges: [number, number][] = [];
  let pos = 0;
  const low = enText.toLowerCase();
  for (const w of surfacesList) {
    const ws = w.trim();
    if (!ws) {
      ranges.push([pos, pos]);
      continue;
    }
    while (pos < enText.length && /\s/.test(enText[pos]!)) pos++;
    if (pos >= enText.length) return null;
    const wl = ws.toLowerCase();
    let found = low.indexOf(wl, pos);
    if (found < 0) found = low.indexOf(wl, Math.max(0, pos - 40));
    if (found < 0) return null;
    ranges.push([found, found + ws.length]);
    pos = found + ws.length;
  }
  return ranges.length ? ranges : null;
}

function charSpanToWordSpan(
  ranges: [number, number][],
  charStart: number,
  charEnd: number,
): [number, number] | null {
  if (charEnd <= charStart) return null;
  let wStart: number | null = null;
  let wEnd = 0;
  for (let i = 0; i < ranges.length; i++) {
    const [a, b] = ranges[i]!;
    if (b > charStart && a < charEnd) {
      if (wStart === null) wStart = i;
      wEnd = i;
    }
  }
  if (wStart === null) return null;
  return [wStart, wEnd];
}

export function findWordSpanForPhrase(
  words: WordToken[],
  enText: string,
  selected: string,
): { wStart: number; wEnd: number } | null {
  const sel = norm(selected);
  if (!sel || words.length === 0) return null;
  const n = words.length;
  const surf = surfaces(words);

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const chunk = norm(surf.slice(i, j + 1).join(" "));
      if (chunk && chunk === sel) return { wStart: i, wEnd: j };
    }
  }

  const selC = lettersCompact(selected);
  if (selC.length >= 2) {
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const chunk = surf.slice(i, j + 1).join(" ");
        if (lettersCompact(chunk) === selC) return { wStart: i, wEnd: j };
      }
    }
  }

  const phraseToks = tokenCount(selected);
  const flex = flexSpanInEnText(enText, selected);
  if (flex) {
    const wr = wordCharRangesInEn(enText, surf);
    if (wr && wr.length === surf.length) {
      const mapped = charSpanToWordSpan(wr, flex.start, flex.end);
      if (mapped) {
        const [a, b] = mapped;
        if (phraseToks < 2 || b - a + 1 === phraseToks) return { wStart: a, wEnd: b };
      }
    }
  }

  let best: { score: number; i: number; j: number } | null = null;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const chunk = norm(surf.slice(i, j + 1).join(" "));
      if (!chunk) continue;
      if (chunk === sel) return { wStart: i, wEnd: j };
      if (phraseToks >= 2 && j - i + 1 !== phraseToks) continue;
      if (sel.includes(chunk) || chunk.includes(sel)) {
        const shorter = Math.min(chunk.length, sel.length);
        const longer = Math.max(chunk.length, sel.length);
        if (shorter < 4 && longer > shorter * 2) continue;
        if (phraseToks >= 2 && chunk !== sel) continue;
        const score = Math.abs(chunk.length - sel.length);
        if (!best || score < best.score) best = { score, i, j };
      }
    }
  }
  if (best) return { wStart: best.i, wEnd: best.j };
  return null;
}

function tokenCount(s: string): number {
  return norm(s)
    .split(/\s+/)
    .filter(Boolean).length;
}

function spanAlignsWithSelection(surf: string[], i: number, j: number, selectedRaw: string): boolean {
  const selectedNorm = norm(selectedRaw);
  if (!selectedNorm) return false;
  const chunk = norm(surf.slice(i, j + 1).join(" "));
  if (!chunk) return false;
  const nPhrase = tokenCount(selectedRaw);
  const nChunk = j - i + 1;
  // 多词词组必须与句中连续词数一致，禁止「trendy jobs」靠 includes 对齐到单独的「jobs」。
  if (nPhrase >= 2 && nChunk !== nPhrase) return false;
  if (lettersCompact(surf.slice(i, j + 1).join(" ")) === lettersCompact(selectedRaw)) return true;
  if (chunk === selectedNorm) return true;
  if (nPhrase === 1) return lettersCompact(chunk) === lettersCompact(selectedRaw);
  return false;
}

/** Merge text-only phrase items into segments by aligning to words[] + en text (same idea as bilingual_packager phrase_utils). */
export function mergePhrasesSidecarIntoSegments(
  segments: SubtitleSegment[],
  items: PhraseSidecarItem[],
): SubtitleSegment[] {
  const out: SubtitleSegment[] = segments.map((s) => ({
    ...s,
    phrases: [...(s.phrases ?? [])],
  }));

  for (const item of items) {
    const sel = item.text?.trim() ?? "";
    if (!sel) continue;

    for (let si = 0; si < out.length; si++) {
      const seg = out[si]!;
      const words = seg.words ?? [];
      if (words.length === 0) continue;

      const enText = seg.text ?? "";
      const span = findWordSpanForPhrase(words, enText, sel);
      if (!span) continue;

      const surf = surfaces(words);
      if (!spanAlignsWithSelection(surf, span.wStart, span.wEnd, sel)) continue;

      const phraseText = normWs(sel);
      const { zh: zhN, reason: reasonN } = normalizePhraseSidecarZhReason(item.zh, item.reason);
      const phrase: PhraseSpan = {
        text: phraseText,
        wStart: span.wStart,
        wEnd: span.wEnd,
        reason: reasonN,
        zh: zhN,
      };

      const dup = (seg.phrases ?? []).some(
        (p) => p.wStart === phrase.wStart && p.wEnd === phrase.wEnd && norm(p.text) === norm(phrase.text),
      );
      if (dup) continue;

      if (!seg.phrases) seg.phrases = [];
      seg.phrases.push(phrase);
    }
  }

  return out;
}

export function parsePhrasesSidecarJson(raw: unknown): PhraseSidecarItem[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const items = o.items;
  if (!Array.isArray(items)) return [];
  const out: PhraseSidecarItem[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) continue;
    out.push({
      text,
      zh: typeof r.zh === "string" ? r.zh : null,
      reason: typeof r.reason === "string" ? r.reason : null,
    });
  }
  return out;
}
