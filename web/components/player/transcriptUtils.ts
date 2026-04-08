import type { SubtitleSegment } from "@/lib/domain/types";

export type ActiveWord = {
  segIndex: number;
  wordIndex: number;
} | null;

export function pickActive(subtitles: SubtitleSegment[], t: number): ActiveWord {
  const segIndex = subtitles.findIndex((s) => t >= s.start && t <= s.end);
  if (segIndex < 0) return null;
  const words = subtitles[segIndex].words ?? [];
  const wordIndex = words.findIndex((w) => t >= w.s && t <= w.e);
  return { segIndex, wordIndex: Math.max(-1, wordIndex) };
}

/** Subtitle index for keyboard prev/next when playhead is in a gap or active is null. */
export function resolveNavSegIndex(subtitles: SubtitleSegment[], t: number, hint: ActiveWord): number {
  if (hint?.segIndex != null) return hint.segIndex;
  const picked = pickActive(subtitles, t);
  if (picked) return picked.segIndex;
  if (!subtitles.length) return 0;
  if (t < subtitles[0]!.start) return 0;
  const lastI = subtitles.length - 1;
  if (t > subtitles[lastI]!.end) return lastI;
  const nextIdx = subtitles.findIndex((s) => s.start > t);
  return nextIdx <= 0 ? 0 : nextIdx - 1;
}

export function clampTimeToSegment(seg: SubtitleSegment, t: number): number {
  return Math.min(seg.end, Math.max(seg.start, t));
}

/**
 * Seek using word timestamps only when they fall inside the cue window (Sonix merge / tooling can drift).
 * Otherwise use cue start so playback matches the subtitle line that lists the token.
 */
export function resolveSeekTimeInSegment(seg: SubtitleSegment, tokenStart: number): number {
  const pad = 0.08;
  if (tokenStart >= seg.start - pad && tokenStart <= seg.end + pad) {
    return clampTimeToSegment(seg, tokenStart);
  }
  return seg.start;
}

export function levelClass(level?: string | null) {
  if (!level) return "text-zinc-900 dark:text-zinc-100";
  if (level === "basic") return "text-zinc-900 dark:text-zinc-100";
  if (level.startsWith("cet")) return "text-emerald-700 dark:text-emerald-400";
  if (level === "ielts") return "text-violet-700 dark:text-violet-400";
  if (level === "tech") return "text-sky-700 dark:text-sky-400";
  return "text-amber-700 dark:text-amber-400";
}

export function fmtStamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

