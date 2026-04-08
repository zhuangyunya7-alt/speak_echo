import type { PhraseSpan, SubtitleSegment, WordToken } from "@/lib/domain/types";
import { normalizeFlashcardWordSurface } from "@/lib/text/flashcardWord";
import { clampTimeToSegment, resolveSeekTimeInSegment } from "@/components/player/transcriptUtils";

function normSelection(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Map selected subtitle text to consecutive word indices; null if not aligned to tokens. */
export function findWordRangeForSelection(seg: SubtitleSegment, selectedRaw: string): { wStart: number; wEnd: number } | null {
  const words = seg.words ?? [];
  if (words.length === 0) return null;
  const target = normSelection(selectedRaw).toLowerCase();
  if (!target) return null;

  for (let i = 0; i < words.length; i++) {
    for (let j = i; j < words.length; j++) {
      const piece = normSelection(words.slice(i, j + 1).map((w) => w.w).join(" ")).toLowerCase();
      if (piece === target) return { wStart: i, wEnd: j };
    }
  }
  return null;
}

export function timeRangeForSelection(
  seg: SubtitleSegment,
  selectedRaw: string,
): { word_start: number; word_end: number } {
  const range = findWordRangeForSelection(seg, selectedRaw);
  if (!range) {
    return { word_start: seg.start, word_end: seg.end };
  }
  const words = seg.words ?? [];
  const ws = words[range.wStart]?.s ?? seg.start;
  const we = words[range.wEnd]?.e ?? seg.end;
  return {
    word_start: resolveSeekTimeInSegment(seg, ws),
    word_end: clampTimeToSegment(seg, we),
  };
}

function clampPhraseSpan(span: PhraseSpan, wordCount: number): PhraseSpan | null {
  const wStart = Math.max(0, Math.min(wordCount - 1, span.wStart));
  const wEnd = Math.max(0, Math.min(wordCount - 1, span.wEnd));
  if (!Number.isFinite(wStart) || !Number.isFinite(wEnd) || wEnd < wStart) return null;
  return { ...span, wStart, wEnd };
}

function phraseCovers(phrases: PhraseSpan[] | undefined, wi: number): PhraseSpan | null {
  if (!phrases?.length) return null;
  let best: PhraseSpan | null = null;
  for (const p of phrases) {
    if (wi < p.wStart || wi > p.wEnd) continue;
    if (!best) best = p;
    else if (p.wEnd - p.wStart > best.wEnd - best.wStart) best = p;
  }
  return best;
}

function isVocabWord(w: WordToken, classifyWord: (word: string) => boolean): boolean {
  if (classifyWord(w.w)) return true;
  const lv = w.level;
  return lv === "hard" || lv === "cet4" || lv === "cet6" || lv === "ielts";
}

/** Soft hint: selection matches a curated highlight in this cue (word or phrase). */
export function selectionMatchesCuratedHighlight(
  seg: SubtitleSegment,
  selectedRaw: string,
  classifyWord: (word: string) => boolean,
): boolean {
  const sel = normSelection(selectedRaw).toLowerCase();
  if (!sel) return false;
  const words = seg.words ?? [];
  const rawPhrases = Array.isArray(seg.phrases) ? seg.phrases : [];
  const phrases = rawPhrases.map((p) => clampPhraseSpan(p, words.length)).filter((x): x is PhraseSpan => !!x);

  for (const p of phrases) {
    const spanLen = p.wEnd - p.wStart + 1;
    if (spanLen < 2) continue;
    const surface = normSelection(words.slice(p.wStart, p.wEnd + 1).map((x) => x.w).join(" ")).toLowerCase();
    if (surface && surface === sel) return true;
  }

  for (const w of words) {
    if (!isVocabWord(w, classifyWord)) continue;
    const one = normSelection(normalizeFlashcardWordSurface(w.w) || w.w).toLowerCase();
    if (one && one === sel) return true;
  }

  return false;
}
