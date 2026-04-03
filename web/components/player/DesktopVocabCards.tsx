"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { normalizePhraseSidecarZhReason } from "@/lib/domain/phraseSidecar";
import type { PhraseSpan, SubtitleSegment, VocabDisplayEntry } from "@/lib/domain/types";

type DictPhonetic = { text?: string };
type DictApiEntry = {
  word?: string;
  phonetics?: DictPhonetic[];
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string }>;
  }>;
};

type CardMeta = {
  ipa: string;
  zhMeaning: string;
};

/** Unified pill: no per-level color; theme purple only. */
const KIND_BADGE =
  "inline-flex w-fit rounded-md border border-[#602D89]/25 bg-[#602D89]/8 px-2 py-0.5 text-[11px] font-medium text-[#602D89] dark:border-[#9D6AD6]/35 dark:bg-[#9D6AD6]/12 dark:text-[#C8A6EB]";

type DesktopCard =
  | {
      kind: "word";
      key: string;
      display: string;
      seekTime: number;
      segIndex: number;
      /** 该词首次出现所在字幕句（英文） */
      exampleEn: string;
      /** 该句中文翻译（若有） */
      exampleZh: string;
    }
  | {
      kind: "phrase";
      key: string;
      display: string;
      reason?: string | null;
      zh?: string | null;
      seekTime: number;
      segIndex: number;
      exampleEn: string;
      exampleZh: string;
    };

function CardExample({ exampleEn, exampleZh }: { exampleEn: string; exampleZh: string }) {
  if (!exampleEn.trim() && !exampleZh.trim()) return null;
  return (
    <div className="mt-3 border-t border-zinc-200/90 pt-3 dark:border-zinc-700/90">
      <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">例句</div>
      {exampleEn.trim() ? (
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{exampleEn.trim()}</p>
      ) : null}
      {exampleZh.trim() ? (
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{exampleZh.trim()}</p>
      ) : exampleEn.trim() ? (
        <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">（本句暂无中文翻译）</p>
      ) : null}
    </div>
  );
}

function normalizeWord(word: string) {
  return word
    .toLowerCase()
    .replace(/^[^a-z]+/i, "")
    .replace(/[^a-z]+$/i, "");
}

/** Strip outer punctuation for display (keeps internal apostrophe in don't). */
function surfaceForDisplay(raw: string): string {
  return raw
    .trim()
    .replace(/^[\s"'“”‘’[\]()]+/u, "")
    .replace(/[\s,.;:!?。，、；：'"'"'"'")\]]+$/u, "");
}

function clampPhraseSpan(span: PhraseSpan, wordCount: number): PhraseSpan | null {
  const wStart = Math.max(0, Math.min(wordCount - 1, span.wStart));
  const wEnd = Math.max(0, Math.min(wordCount - 1, span.wEnd));
  if (!Number.isFinite(wStart) || !Number.isFinite(wEnd)) return null;
  if (wEnd < wStart) return null;
  return { ...span, wStart, wEnd };
}

function firstIpa(entry: DictApiEntry | undefined): string {
  if (!entry?.phonetics?.length) return "";
  for (const p of entry.phonetics) {
    const t = p.text?.trim();
    if (t) return t;
  }
  return "";
}

function posZh(pos?: string) {
  const p = (pos ?? "").toLowerCase();
  if (!p) return "";
  if (p === "noun") return "名词";
  if (p === "verb") return "动词";
  if (p === "adjective") return "形容词";
  if (p === "adverb") return "副词";
  if (p === "preposition") return "介词";
  if (p === "pronoun") return "代词";
  if (p === "conjunction") return "连词";
  if (p === "interjection") return "感叹词";
  if (p === "determiner") return "限定词";
  return pos ?? "";
}

async function lookupDictionary(word: string): Promise<{
  ipa: string;
  posZh: string;
  enDefinition: string;
} | null> {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as unknown;
  const arr = Array.isArray(json) ? (json as DictApiEntry[]) : [];
  const first = arr[0];
  const meaning = first?.meanings?.[0];
  const definition = meaning?.definitions?.[0]?.definition?.trim() ?? "";
  return {
    ipa: firstIpa(first),
    posZh: posZh(meaning?.partOfSpeech),
    enDefinition: definition,
  };
}

async function translateToZh(text: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  const res = await fetch(`/api/translate-zh?text=${encodeURIComponent(t)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { translated?: string };
  const translated = json.translated?.trim() ?? "";
  return translated || null;
}

async function ipaAndZhForLemma(lemma: string): Promise<CardMeta> {
  const key = lemma.trim().toLowerCase();
  let ipa = "";
  let zhMeaning = "";

  try {
    const dict = await lookupDictionary(key);
    ipa = dict?.ipa ?? "";
    const def = dict?.enDefinition?.trim() ?? "";
    zhMeaning = (await translateToZh(key)) ?? "";
    if (!zhMeaning && def) zhMeaning = (await translateToZh(def)) ?? "";
  } catch {
    /* ignore */
  }

  if (!zhMeaning) zhMeaning = (await translateToZh(key)) ?? "";

  return { ipa, zhMeaning };
}

export function DesktopVocabCards({
  videoId,
  subtitles,
  classifyWord,
  vocabDisplay,
  onSeek,
}: {
  videoId: string;
  subtitles: SubtitleSegment[];
  /** 仅词表收录的词进入「单词」卡片（与 vocabulary_levels.json 一致）。 */
  classifyWord: (w: string) => boolean;
  /** 离线 sidecar：与弹层共用同一文案。 */
  vocabDisplay?: Record<string, VocabDisplayEntry>;
  onSeek: (t: number, segIndex?: number) => void;
}) {
  const cards = useMemo<DesktopCard[]>(() => {
    const wordMap = new Map<string, DesktopCard & { kind: "word" }>();
    const phraseOut: Array<DesktopCard & { kind: "phrase" }> = [];
    const seenPhraseSurface = new Set<string>();

    subtitles.forEach((seg, segIndex) => {
      const words = seg.words ?? [];
      const exampleEn = seg.text?.trim() ?? "";
      const exampleZh = seg.zh?.trim() ?? "";

      for (const w of words) {
        if (!classifyWord(w.w)) continue;
        const key = normalizeWord(w.w);
        if (!key) continue;
        if (!wordMap.has(key)) {
          const vis = surfaceForDisplay(w.w);
          wordMap.set(key, {
            kind: "word",
            key,
            display: vis || w.w,
            seekTime: w.s,
            segIndex,
            exampleEn,
            exampleZh,
          });
        }
      }

      const rawPhrases = Array.isArray(seg.phrases) ? seg.phrases : [];
      for (let pi = 0; pi < rawPhrases.length; pi++) {
        const p = rawPhrases[pi]!;
        const clamped = clampPhraseSpan(p, words.length);
        if (!clamped) continue;
        const spanLen = clamped.wEnd - clamped.wStart + 1;
        if (spanLen < 2) continue;
        const slice = words.slice(clamped.wStart, clamped.wEnd + 1);
        const surface = slice.map((x) => x.w).join(" ").trim();
        if (!surface) continue;
        const surfNorm = surface.toLowerCase().replace(/\s+/g, " ").trim();
        if (seenPhraseSurface.has(surfNorm)) continue;
        seenPhraseSurface.add(surfNorm);

        const firstTok = slice[0]!;
        phraseOut.push({
          kind: "phrase",
          key: `phrase-${segIndex}-${clamped.wStart}-${clamped.wEnd}-${pi}`,
          display: surface,
          reason: p.reason ?? null,
          zh: p.zh ?? null,
          seekTime: firstTok.s,
          segIndex,
          exampleEn,
          exampleZh,
        });
      }
    });

    const wordCards = Array.from(wordMap.values());
    return [...wordCards, ...phraseOut].sort((a, b) => {
      if (a.segIndex !== b.segIndex) return a.segIndex - b.segIndex;
      if (a.seekTime !== b.seekTime) return a.seekTime - b.seekTime;
      if (a.kind !== b.kind) return a.kind === "word" ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
  }, [subtitles, classifyWord]);

  const wordKeys = useMemo(() => cards.filter((c): c is DesktopCard & { kind: "word" } => c.kind === "word"), [cards]);

  const [metaByKey, setMetaByKey] = useState<Record<string, CardMeta>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const vocabDisplayRef = useRef<Record<string, VocabDisplayEntry> | undefined>(vocabDisplay);
  vocabDisplayRef.current = vocabDisplay;

  useEffect(() => {
    fetchedRef.current = new Set();
    setMetaByKey({});
  }, [videoId]);

  /** sidecar 可能晚于首屏加载；只要条目出现就写入，且覆盖先前的「加载中」占位。 */
  useEffect(() => {
    if (!vocabDisplay || Object.keys(vocabDisplay).length === 0) return;
    setMetaByKey((prev) => {
      const next = { ...prev };
      for (const c of wordKeys) {
        const off = vocabDisplay[c.key];
        if (off) {
          next[c.key] = { ipa: off.ipa ?? "", zhMeaning: off.zh };
        }
      }
      return next;
    });
  }, [wordKeys, vocabDisplay]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      for (const c of wordKeys) {
        if (cancelled) return;
        if (vocabDisplayRef.current?.[c.key]) continue;

        if (fetchedRef.current.has(c.key)) continue;
        fetchedRef.current.add(c.key);

        const meta = await ipaAndZhForLemma(c.key);

        if (cancelled) return;
        const sidecar = vocabDisplayRef.current?.[c.key];
        setMetaByKey((prev) => ({
          ...prev,
          [c.key]: sidecar
            ? { ipa: sidecar.ipa ?? "", zhMeaning: sidecar.zh }
            : meta,
        }));
        await new Promise((r) => setTimeout(r, 120));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wordKeys, vocabDisplay]);

  const wordCount = cards.filter((c) => c.kind === "word").length;
  const phraseCount = cards.filter((c) => c.kind === "phrase").length;

  const [tab, setTab] = useState<"word" | "phrase">(() => (wordCount > 0 ? "word" : "phrase"));

  useEffect(() => {
    setTab(wordCount > 0 ? "word" : "phrase");
  }, [videoId, wordCount, phraseCount]);

  if (cards.length === 0) return null;

  const visibleCards = tab === "word" ? cards.filter((c) => c.kind === "word") : cards.filter((c) => c.kind === "phrase");

  return (
    <section className="hidden lg:block rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">本视频难词</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">点击卡片跳转到对应字幕并播放</p>
          <div
            className="mt-3 inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700"
            role="tablist"
            aria-label="单词与词组"
          >
            <button
              role="tab"
              type="button"
              aria-selected={tab === "word"}
              disabled={wordCount === 0}
              onClick={() => setTab("word")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                tab === "word"
                  ? "bg-[#602D89]/12 text-[#602D89] shadow-sm dark:bg-[#9D6AD6]/20 dark:text-[#C8A6EB]"
                  : "text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100",
              )}
            >
              单词
              <span className="ml-1 text-xs font-normal tabular-nums opacity-80">({wordCount})</span>
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={tab === "phrase"}
              disabled={phraseCount === 0}
              onClick={() => setTab("phrase")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                tab === "phrase"
                  ? "bg-[#602D89]/12 text-[#602D89] shadow-sm dark:bg-[#9D6AD6]/20 dark:text-[#C8A6EB]"
                  : "text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100",
              )}
            >
              词组
              <span className="ml-1 text-xs font-normal tabular-nums opacity-80">({phraseCount})</span>
            </button>
          </div>
        </div>
        <div className="shrink-0 text-left text-xs text-zinc-500 sm:text-right dark:text-zinc-400">
          <div>
            当前 {visibleCards.length} 张 · 合计 {cards.length} 张
          </div>
          <div className="mt-0.5 text-[11px] opacity-90">
            {wordCount} 词 · {phraseCount} 组
          </div>
        </div>
      </div>

      {visibleCards.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {tab === "word" ? "本视频暂无单词卡片。" : "本视频暂无词组卡片。"}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleCards.map((card) => {
            if (card.kind === "phrase") {
              const gloss = normalizePhraseSidecarZhReason(card.zh, card.reason);
              const sub = gloss.zh?.trim() || gloss.reason?.trim() || null;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => onSeek(card.seekTime, card.segIndex)}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left transition hover:border-zinc-300 hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/30 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/50"
                >
                  <div className={KIND_BADGE}>词组</div>
                  <div className="mt-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {card.display}
                  </div>
                  {sub ? (
                    <div className="mt-2 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">{sub}</div>
                  ) : (
                    <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">（暂无补充说明）</div>
                  )}
                  <CardExample exampleEn={card.exampleEn} exampleZh={card.exampleZh} />
                </button>
              );
            }

            const m = metaByKey[card.key];
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => onSeek(card.seekTime, card.segIndex)}
                className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left transition hover:border-zinc-300 hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/30 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/50"
              >
                <div className={KIND_BADGE}>单词</div>
                <div className="mt-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {card.display}
                </div>
                <div className="mt-1 font-mono text-sm text-zinc-600 dark:text-zinc-300">
                  {!m ? "音标加载中…" : m.ipa?.trim() || "暂无音标"}
                </div>
                <div className="mt-2 text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
                  {!m ? "中文释义加载中…" : m.zhMeaning || "暂无中文释义"}
                </div>
                <CardExample exampleEn={card.exampleEn} exampleZh={card.exampleZh} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
