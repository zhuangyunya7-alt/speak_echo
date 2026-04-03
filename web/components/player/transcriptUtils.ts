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

