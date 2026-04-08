"use client";

import { useEffect, useRef, useState } from "react";
import type { Flashcard, PhraseSpan, SubtitleSegment, WordToken } from "@/lib/domain/types";
import { TranscriptCustomFlashcardPanel } from "@/components/player/TranscriptCustomFlashcardPanel";
import type { ActiveWord } from "@/components/player/transcriptUtils";
import { fmtStamp } from "@/components/player/transcriptUtils";

/** 难词：主题紫下划线（与激活词一致）。 */
const HIGHLIGHT_UNDERLINE =
  "underline decoration-2 underline-offset-4 decoration-[#602D89] dark:decoration-[#9D6AD6]";

/** 词组：浅紫底块，区别于难词下划线。 */
const PHRASE_HIGHLIGHT =
  "inline-block rounded-md bg-[#602D89]/14 px-1 py-0.5 ring-1 ring-[#602D89]/20 dark:bg-[#9D6AD6]/22 dark:ring-[#9D6AD6]/35";

function isVocabWord(
  w: WordToken,
  classifyWord: (word: string) => boolean,
): boolean {
  if (classifyWord(w.w)) return true;
  const lv = w.level;
  return lv === "hard" || lv === "cet4" || lv === "cet6" || lv === "ielts";
}

function clampPhraseSpan(span: PhraseSpan, wordCount: number): PhraseSpan | null {
  const wStart = Math.max(0, Math.min(wordCount - 1, span.wStart));
  const wEnd = Math.max(0, Math.min(wordCount - 1, span.wEnd));
  if (!Number.isFinite(wStart) || !Number.isFinite(wEnd)) return null;
  if (wEnd < wStart) return null;
  return { ...span, wStart, wEnd };
}

function phraseCovers(phrases: PhraseSpan[] | undefined, wi: number) {
  if (!phrases || phrases.length === 0) return null;
  // Prefer the longest span when overlaps exist.
  let best: PhraseSpan | null = null;
  for (const p of phrases) {
    if (wi < p.wStart || wi > p.wEnd) continue;
    if (!best) best = p;
    else {
      const bestLen = best.wEnd - best.wStart;
      const curLen = p.wEnd - p.wStart;
      if (curLen > bestLen) best = p;
    }
  }
  return best;
}

function IconSquareButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative group">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={[
          "inline-flex h-8 w-8 items-center justify-center rounded-md border transition",
          active
            ? "border-[#602D89]/40 bg-[#602D89]/10 text-[#602D89] dark:border-[#9D6AD6]/40 dark:bg-[#9D6AD6]/15 dark:text-[#C8A6EB]"
            : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900/60",
        ].join(" ")}
      >
        {children}
      </button>
      <div className="pointer-events-none absolute right-0 top-9 z-30 hidden min-w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 shadow-md group-hover:block dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
        {label}
      </div>
    </div>
  );
}

export function TranscriptPane({
  subtitles,
  active,
  listRef,
  lineRefs,
  autoScroll,
  onToggleAutoScroll,
  bilingualSubtitles,
  onToggleBilingualSubtitles,
  loopMode,
  onChangeLoopMode,
  singleRepeatCount,
  onChangeSingleRepeatCount,
  autoNextSentence,
  onToggleAutoNextSentence,
  classifyWord,
  onSeek,
  onWordClick,
  listMaxHeightClass,
  customFlashcard,
}: {
  subtitles: SubtitleSegment[];
  active: ActiveWord;
  listRef: React.RefObject<HTMLDivElement | null>;
  lineRefs: React.MutableRefObject<Array<HTMLDivElement | null>>;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  /** true：显示英文 + 中文翻译；false：仅英文（或分词行） */
  bilingualSubtitles: boolean;
  onToggleBilingualSubtitles: () => void;
  loopMode: "continuous" | "single";
  onChangeLoopMode: (m: "continuous" | "single") => void;
  singleRepeatCount: number;
  onChangeSingleRepeatCount: (n: number) => void;
  autoNextSentence: boolean;
  onToggleAutoNextSentence: () => void;
  classifyWord: (w: string) => boolean;
  onSeek: (t: number, segIndex: number) => void;
  onWordClick: (
    w: WordToken,
    seg: SubtitleSegment,
    rect: DOMRect,
    phrase: { text: string; reason?: string | null; zh?: string | null; wStart: number; wEnd: number; surface: string } | null,
  ) => void;
  listMaxHeightClass?: string;
  /** 划词自定义闪卡；不传则不启用选区收藏。 */
  customFlashcard?: {
    video: { id: string; title: string };
    addFlashcard: (draft: Omit<Flashcard, "id" | "user_id" | "created_at">) => Promise<string>;
    patchFlashcard: (id: string, patch: Partial<Flashcard>) => Promise<void>;
    byFlashcardWord: (word: string) => Flashcard | null;
  };
}) {
  const [openPanel, setOpenPanel] = useState<null | "scroll" | "loop">(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /**
   * Some subtitle sources have `en_text` but omit punctuation/digits in `words[]`.
   * In that case, rendering `words[]` only will drop symbols like `$2`.
   *
   * We detect the common case (`$`/digits exist in `seg.text` but not in any `words[].w`)
   * and fall back to rendering `seg.text` to keep the visual content correct.
   */
  const shouldFallbackToRawText = (seg: SubtitleSegment) => {
    const text = seg.text ?? "";
    const words = seg.words ?? [];
    if (words.length === 0) return false;
    if (!/[$0-9]/.test(text)) return false;
    const wordsText = words.map((w) => w.w).join(" ");
    return !/[$0-9]/.test(wordsText);
  };

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!panelRef.current) return;
      const target = e.target as Node;
      if (!panelRef.current.contains(target)) setOpenPanel(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="text-sm font-semibold">动态字幕</div>
        <div ref={panelRef} className="relative flex items-center gap-2">
          <IconSquareButton
            label={autoScroll ? "自动滚动已开启" : "自动滚动已关闭"}
            active={autoScroll}
            onClick={() => setOpenPanel((v) => (v === "scroll" ? null : "scroll"))}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M10 3v14M6.5 6.5 10 3l3.5 3.5M6.5 13.5 10 17l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconSquareButton>
          <IconSquareButton
            label={loopMode === "single" ? "句子循环已开启" : "连续播放"}
            active={loopMode === "single"}
            onClick={() => setOpenPanel((v) => (v === "loop" ? null : "loop"))}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6h9m0 0-2.2-2M13 6l-2.2 2M16 14H7m0 0 2.2-2M7 14l2.2 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconSquareButton>
          <IconSquareButton
            label={bilingualSubtitles ? "双语字幕：中英文" : "双语字幕：仅英文"}
            active={bilingualSubtitles}
            onClick={() => {
              setOpenPanel(null);
              onToggleBilingualSubtitles();
            }}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
              <path
                d="M3.5 5.5h13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"
                strokeLinejoin="round"
              />
              <path d="M5.5 9h7M5.5 12h8.5" strokeLinecap="round" />
            </svg>
          </IconSquareButton>

          {openPanel ? (
            <div className="absolute right-0 top-10 z-40 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
              {openPanel === "scroll" ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">自动滚动</div>
                  <button
                    type="button"
                    onClick={onToggleAutoScroll}
                    className="flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                  >
                    <span>{autoScroll ? "开" : "关"}</span>
                    <span
                      className={[
                        "h-2.5 w-2.5 rounded-full",
                        autoScroll ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600",
                      ].join(" ")}
                    />
                  </button>
                </div>
              ) : null}

              {openPanel === "loop" ? (
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">句子播放</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onChangeLoopMode("continuous")}
                      className={[
                        "rounded-lg border px-2 py-2 text-xs",
                        loopMode === "continuous"
                          ? "border-[#602D89]/40 bg-[#602D89]/10 text-[#602D89] dark:text-[#C8A6EB]"
                          : "border-zinc-200 dark:border-zinc-700",
                      ].join(" ")}
                    >
                      连续播放
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeLoopMode("single")}
                      className={[
                        "rounded-lg border px-2 py-2 text-xs",
                        loopMode === "single"
                          ? "border-[#602D89]/40 bg-[#602D89]/10 text-[#602D89] dark:text-[#C8A6EB]"
                          : "border-zinc-200 dark:border-zinc-700",
                      ].join(" ")}
                    >
                      单句循环
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onChangeLoopMode(loopMode === "single" ? "continuous" : "single")}
                    className="flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                  >
                    <span>句子循环</span>
                    <span className={loopMode === "single" ? "text-emerald-600" : "text-zinc-500"}>
                      {loopMode === "single" ? "开" : "关"}
                    </span>
                  </button>

                  {loopMode === "single" ? (
                    <>
                      <div className="space-y-1">
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">循环次数</div>
                        <select
                          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                          value={singleRepeatCount}
                          onChange={(e) => {
                            const n = Number(e.target.value) || 1;
                            const allowed = [1, 2, 3, 5, 10];
                            onChangeSingleRepeatCount(allowed.includes(n) ? n : 1);
                          }}
                        >
                          <option value={1}>循环 1 次</option>
                          <option value={2}>循环 2 次</option>
                          <option value={3}>循环 3 次</option>
                          <option value={5}>循环 5 次</option>
                          <option value={10}>循环 10 次</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={onToggleAutoNextSentence}
                        className="flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
                      >
                        <span>自动下句</span>
                        <span className={autoNextSentence ? "text-emerald-600" : "text-zinc-500"}>
                          {autoNextSentence ? "开" : "关"}
                        </span>
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-b border-zinc-200 bg-[#602D89]/[0.06] px-4 py-2.5 dark:border-zinc-800 dark:bg-[#9D6AD6]/10">
        <p className="text-center text-xs font-medium text-[#602D89] dark:text-[#C8A6EB]">
          快捷键：<kbd className="rounded border border-[#602D89]/30 bg-white/90 px-1.5 py-0.5 font-mono text-[11px] dark:border-[#9D6AD6]/35 dark:bg-zinc-950/80">↑</kbd>{" "}
          上一句 ·{" "}
          <kbd className="rounded border border-[#602D89]/30 bg-white/90 px-1.5 py-0.5 font-mono text-[11px] dark:border-[#9D6AD6]/35 dark:bg-zinc-950/80">↓</kbd>{" "}
          下一句 · 在英文上划词可添加自定义闪卡
        </p>
      </div>

      <div ref={listRef} className={[listMaxHeightClass ?? "max-h-[82dvh]", "overflow-auto p-2"].join(" ")}>
        {subtitles.map((seg, idx) => {
          const isActive = active?.segIndex === idx;
          return (
            <div
              key={`${seg.start}-${idx}`}
              data-seg-index={idx}
              ref={(el) => {
                lineRefs.current[idx] = el;
              }}
              className={[
                "rounded-xl border p-3 transition",
                isActive
                  ? "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40"
                  : "border-transparent hover:border-zinc-200 hover:bg-zinc-50/70 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/20",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => onSeek(seg.start, idx)}
                className="w-full text-left"
                aria-label={`跳转到 ${seg.start} 秒`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {fmtStamp(seg.start)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="select-text text-base leading-7 text-zinc-900 dark:text-zinc-100">
                      {(seg.words ?? []).length > 0 && !shouldFallbackToRawText(seg) ? (
                        <span className="space-x-1">
                          {(() => {
                            const words = seg.words ?? [];
                            const rawPhrases = Array.isArray(seg.phrases) ? seg.phrases : [];
                            const phrases = rawPhrases
                              .map((p) => clampPhraseSpan(p, words.length))
                              .filter((x): x is PhraseSpan => !!x);

                            type Run =
                              | { kind: "word"; wi: number }
                              | { kind: "phrase"; wStart: number; wEnd: number };

                            const runs: Run[] = [];
                            let i = 0;
                            while (i < words.length) {
                              const p = phraseCovers(phrases, i);
                              if (p) {
                                runs.push({ kind: "phrase", wStart: p.wStart, wEnd: p.wEnd });
                                i = p.wEnd + 1;
                              } else {
                                runs.push({ kind: "word", wi: i });
                                i++;
                              }
                            }

                            const renderWord = (w: WordToken, wi: number, inPhrase: boolean, key: string) => {
                              const wordActive = isActive && active?.wordIndex === wi;
                              const vocabHit = isVocabWord(w, classifyWord);
                              const covered = phraseCovers(phrases, wi);
                              const phrasePayload = covered
                                ? {
                                    text: covered.text,
                                    reason: covered.reason ?? null,
                                    zh: covered.zh ?? null,
                                    wStart: covered.wStart,
                                    wEnd: covered.wEnd,
                                    surface: words
                                      .slice(covered.wStart, covered.wEnd + 1)
                                      .map((x) => x.w)
                                      .join(" "),
                                  }
                                : null;
                              const clickable = Boolean(phrasePayload) || vocabHit;
                              return (
                                <span
                                  key={key}
                                  className={[
                                    "inline-block rounded px-1 py-0.5 text-zinc-900 dark:text-zinc-100",
                                    !inPhrase && vocabHit ? HIGHLIGHT_UNDERLINE : null,
                                    wordActive
                                      ? "bg-[#602D89] !text-white font-semibold !decoration-white dark:!decoration-white"
                                      : clickable
                                        ? "cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
                                        : null,
                                  ].join(" ")}
                                  onClick={
                                    clickable
                                      ? (e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                          onWordClick(w, seg, rect, phrasePayload);
                                        }
                                      : undefined
                                  }
                                >
                                  {w.w}
                                </span>
                              );
                            };

                            return runs.map((run, ri) => {
                              if (run.kind === "word") {
                                const w = words[run.wi]!;
                                const inPhrase = Boolean(phraseCovers(phrases, run.wi));
                                return renderWord(w, run.wi, inPhrase, `${w.w}-${w.s}-${run.wi}-${ri}`);
                              }

                              const slice = words.slice(run.wStart, run.wEnd + 1);
                              return (
                                <span
                                  key={`phrase-${seg.start}-${run.wStart}-${run.wEnd}-${ri}`}
                                  className={["space-x-1", PHRASE_HIGHLIGHT].join(" ")}
                                >
                                  {slice.map((w, off) => {
                                    const wi = run.wStart + off;
                                    return renderWord(w, wi, true, `${w.w}-${w.s}-${wi}-${ri}`);
                                  })}
                                </span>
                              );
                            });
                          })()}
                        </span>
                      ) : (
                        seg.text
                      )}
                    </div>
                    {bilingualSubtitles && seg.zh ? (
                      <div className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300 md:text-base md:leading-7">
                        {seg.zh}
                      </div>
                    ) : null}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {customFlashcard ? (
        <TranscriptCustomFlashcardPanel
          listRef={listRef}
          subtitles={subtitles}
          classifyWord={classifyWord}
          video={customFlashcard.video}
          byFlashcardWord={customFlashcard.byFlashcardWord}
          addFlashcard={customFlashcard.addFlashcard}
          patchFlashcard={customFlashcard.patchFlashcard}
        />
      ) : null}
    </div>
  );
}

