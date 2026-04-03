"use client";

import { useMemo } from "react";
import type { SubtitleSegment } from "@/lib/domain/types";

type Template = {
  surface: string;
  zh?: string | null;
  reason?: string | null;
  start: number;
};

export function DesktopSceneTemplates({
  subtitles,
  onSeek,
}: {
  subtitles: SubtitleSegment[];
  onSeek: (t: number) => void;
}) {
  const templates = useMemo<Template[]>(() => {
    const out: Template[] = [];
    const seen = new Set<string>();

    for (const seg of subtitles) {
      const words = seg.words ?? [];
      if (!words.length) continue;
      for (const p of seg.phrases ?? []) {
        if (!p.zh?.trim() && !p.reason?.trim()) continue;
        const wStart = Math.max(0, Math.min(words.length - 1, p.wStart));
        const wEnd = Math.max(0, Math.min(words.length - 1, p.wEnd));
        if (wEnd < wStart) continue;
        const slice = words.slice(wStart, wEnd + 1);
        const surface = slice.map((x) => x.w).join(" ").trim();
        if (!surface) continue;
        const wordCount = surface.split(/\s+/).length;
        if (wordCount < 3) continue;
        const key = surface.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          surface,
          zh: p.zh?.trim() ? p.zh.trim() : null,
          reason: p.reason?.trim() ? p.reason.trim() : null,
          start: seg.start,
        });
      }
    }

    out.sort((a, b) => a.start - b.start);
    return out.slice(0, 5);
  }, [subtitles]);

  if (templates.length === 0) return null;

  async function copyText(text: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  return (
    <section className="hidden lg:block rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">场景表达模板</h2>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{templates.length} 条</div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((t, idx) => (
          <div
            key={`${t.surface}-${idx}`}
            className="group rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left transition hover:border-zinc-300 hover:bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-900/20 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/40"
          >
            <button
              type="button"
              className="w-full text-left"
              onClick={() => onSeek(t.start)}
              aria-label="跳转到该句型所在片段"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-3">
                    {t.surface}
                  </div>
                  {t.zh || t.reason ? (
                    <div className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {t.zh || t.reason}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                  表达模板
                </span>
              </div>
            </button>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void copyText(t.surface)}
                className="inline-flex h-7 items-center rounded-lg border border-zinc-200 px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900/60"
              >
                复制句型
              </button>
              <button
                type="button"
                onClick={() => onSeek(t.start)}
                className="inline-flex h-7 items-center rounded-lg border border-zinc-200 px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900/60"
              >
                跳转到片段
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

