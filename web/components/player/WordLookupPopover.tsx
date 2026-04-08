"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SubtitleSegment, Video, VocabDisplayEntry, WordToken } from "@/lib/domain/types";
import { normalizePhraseSidecarZhReason } from "@/lib/domain/phraseSidecar";
import { normalizeVocabLemma } from "@/lib/domain/vocabDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFlashcards } from "@/lib/flashcards/client";
import { normalizeFlashcardWordSurface } from "@/lib/text/flashcardWord";
import { clampTimeToSegment, resolveSeekTimeInSegment } from "@/components/player/transcriptUtils";

type DictResult = {
  phonetic?: string;
  partOfSpeech?: string;
  definition?: string;
  example?: string;
};

type DictApiEntry = {
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
};

function derivePhraseFromSegment(
  word: WordToken | null,
  segment: SubtitleSegment | null,
): { text: string; reason?: string | null; zh?: string | null; wStart: number; wEnd: number; surface: string } | null {
  if (!word || !segment) return null;
  const words = segment.words ?? [];
  const phrases = segment.phrases ?? [];
  if (words.length === 0 || phrases.length === 0) return null;

  // Prefer time+surface match so duplicated timestamps (bad align) don't grab the wrong token.
  let wi = words.findIndex(
    (w) => w.w === word.w && Math.abs(w.s - word.s) < 0.001 && Math.abs(w.e - word.e) < 0.001,
  );
  if (wi < 0) {
    wi = words.findIndex((w) => Math.abs(w.s - word.s) < 0.001 && Math.abs(w.e - word.e) < 0.001);
  }
  if (wi < 0) wi = words.findIndex((w) => w.w === word.w);
  if (wi < 0) return null;

  let hit: (typeof phrases)[number] | null = null;
  for (const p of phrases) {
    if (wi >= p.wStart && wi <= p.wEnd) {
      if (!hit) hit = p;
      else {
        const curLen = p.wEnd - p.wStart;
        const oldLen = hit.wEnd - hit.wStart;
        if (curLen > oldLen) hit = p;
      }
    }
  }
  if (!hit) return null;

  const wStart = Math.max(0, Math.min(words.length - 1, hit.wStart));
  const wEnd = Math.max(0, Math.min(words.length - 1, hit.wEnd));
  if (wEnd < wStart) return null;
  const surface = words.slice(wStart, wEnd + 1).map((x) => x.w).join(" ");
  return { text: hit.text, reason: hit.reason ?? null, zh: hit.zh ?? null, wStart, wEnd, surface };
}

async function lookup(word: string): Promise<DictResult | null> {
  const w = word.trim().toLowerCase();
  if (!w) return null;
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as unknown;
  const arr = Array.isArray(json) ? (json as DictApiEntry[]) : [];
  const first = arr[0];
  const phonetic = first?.phonetic ?? first?.phonetics?.find((p) => Boolean(p?.text))?.text;
  const meaning = first?.meanings?.[0];
  const partOfSpeech = meaning?.partOfSpeech;
  const def = meaning?.definitions?.[0];
  return {
    phonetic,
    partOfSpeech,
    definition: def?.definition,
    example: def?.example,
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

function speak(word: string) {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function WordLookupPopover({
  open,
  anchorRect,
  word,
  segment,
  phrase,
  video,
  vocabDisplay,
  onClose,
  onSeek,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  word: WordToken | null;
  segment: SubtitleSegment | null;
  phrase: { text: string; reason?: string | null; zh?: string | null; wStart: number; wEnd: number; surface: string } | null;
  video: Video;
  /** Per-video sidecar `*_vocab_display.json` (lemma → zh/ipa/释义). */
  vocabDisplay?: Record<string, VocabDisplayEntry>;
  onClose: () => void;
  onSeek: (t: number) => void;
}) {
  const { byWord, add } = useFlashcards();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 120, left: 24 });
  const [loading, setLoading] = useState(false);
  const [dict, setDict] = useState<DictResult | null>(null);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const [phraseDict, setPhraseDict] = useState<DictResult | null>(null);
  const [meaningZh, setMeaningZh] = useState("");
  const [meaningTouched, setMeaningTouched] = useState(false);

  const current = word?.w ?? "";
  const isPhraseClick = Boolean(phrase);
  const effectivePhrase = useMemo(() => phrase ?? derivePhraseFromSegment(word, segment), [phrase, word, segment]);
  const phraseGloss = useMemo(() => {
    if (!effectivePhrase) return { zh: null as string | null, reason: null as string | null };
    return normalizePhraseSidecarZhReason(effectivePhrase.zh, effectivePhrase.reason);
  }, [effectivePhrase?.zh, effectivePhrase?.reason]);
  const flashcardWord = useMemo(() => {
    const raw = isPhraseClick ? effectivePhrase?.surface ?? effectivePhrase?.text ?? current : current;
    return normalizeFlashcardWordSurface(raw) || raw.trim();
  }, [current, effectivePhrase, isPhraseClick]);
  const saved = useMemo(() => (flashcardWord ? byWord(flashcardWord) : null), [byWord, flashcardWord]);

  const lemma = normalizeVocabLemma(current);
  const vocabHit = lemma ? vocabDisplay?.[lemma] : undefined;
  const hasVocabPackageGlossary = Boolean(
    vocabHit &&
      (vocabHit.zh?.trim() || vocabHit.ipa?.trim() || vocabHit.en_definition?.trim()),
  );

  useEffect(() => {
    if (!open || !current || isPhraseClick) return;
    let cancelled = false;
    const off = lemma && vocabDisplay?.[lemma];

    if (off) {
      setLoading(false);
      setDict({
        phonetic: off.ipa,
        partOfSpeech: off.pos,
        definition: off.en_definition?.trim() || undefined,
        example: undefined,
      });
      const pz = posZh(off.pos);
      const zhLine = off.zh.trim();
      setMeaningZh(zhLine ? (pz ? `（${pz}）${off.zh}` : off.zh) : "");
      setMeaningTouched(Boolean(zhLine));
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      setLoading(true);
      setDict(null);
      setMeaningZh("");
      setMeaningTouched(false);
      try {
        const r = await lookup(current);
        if (cancelled) return;
        setDict(r);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, current, vocabDisplay, isPhraseClick, lemma]);

  useEffect(() => {
    if (!open || isPhraseClick) return;
    if (meaningTouched) return;
    if (meaningZh.trim()) return;
    if (vocabHit) return;
    const source = dict?.definition?.trim();
    if (!source) return;
    let cancelled = false;
    (async () => {
      const zh = await translateToZh(source);
      if (cancelled) return;
      if (zh && !meaningTouched) {
        const pos = posZh(dict?.partOfSpeech);
        setMeaningZh(pos ? `（${pos}）${zh}` : zh);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dict?.definition, dict?.partOfSpeech, current, meaningTouched, meaningZh, isPhraseClick, vocabHit]);

  useEffect(() => {
    if (!open || isPhraseClick || !effectivePhrase?.surface) return;
    let cancelled = false;
    (async () => {
      setPhraseLoading(true);
      setPhraseDict(null);
      try {
        // dictionaryapi.dev often doesn't have phrase entries; best-effort only.
        const r = await lookup(effectivePhrase.surface);
        if (cancelled) return;
        setPhraseDict(r);
      } finally {
        if (cancelled) return;
        setPhraseLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, effectivePhrase?.surface, isPhraseClick]);

  useEffect(() => {
    if (!open || !isPhraseClick) return;
    const zhLine = phraseGloss.zh?.trim() ?? "";
    const reasonLine = phraseGloss.reason?.trim() ?? "";
    const nextMeaning = zhLine || reasonLine;

    setLoading(false);
    setDict(null);
    setPhraseLoading(false);
    setPhraseDict(null);
    setMeaningTouched(true);
    setMeaningZh(nextMeaning);
  }, [open, isPhraseClick, phraseGloss.zh, phraseGloss.reason]);

  useLayoutEffect(() => {
    if (!open || !anchorRect) return;
    const el = panelRef.current;
    if (!el) return;

    const margin = 12;
    const gap = 10;
    const { width, height } = el.getBoundingClientRect();

    let left = anchorRect.left;
    const maxLeft = window.innerWidth - margin - width;
    left = Math.min(maxLeft, Math.max(margin, left));

    let top = anchorRect.bottom + gap;
    const maxTop = window.innerHeight - margin - height;
    if (top > maxTop) top = anchorRect.top - gap - height;
    top = Math.min(maxTop, Math.max(margin, top));

    setPosition({ top, left });
  }, [open, anchorRect]);

  if (!open || !word || !segment) return null;

  const headerWord = isPhraseClick ? effectivePhrase?.surface ?? effectivePhrase?.text ?? current : word.w;
  const phraseWordStartRaw =
    isPhraseClick && effectivePhrase && segment.words?.length
      ? segment.words[effectivePhrase.wStart]?.s ?? word.s
      : word.s;
  const phraseWordEndRaw =
    isPhraseClick && effectivePhrase && segment.words?.length
      ? segment.words[effectivePhrase.wEnd]?.e ?? word.e
      : word.e;
  const phraseWordStart = resolveSeekTimeInSegment(segment, phraseWordStartRaw);
  const phraseWordEnd = clampTimeToSegment(segment, phraseWordEndRaw);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div
        className="absolute w-[min(520px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        style={position}
        role="dialog"
        aria-modal="true"
        ref={panelRef}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold tracking-tight">{headerWord}</div>
            {!isPhraseClick ? (
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {dict?.phonetic ? <span className="mr-2">{dict.phonetic}</span> : null}
                {dict?.partOfSpeech ? <span>{dict.partOfSpeech}</span> : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={() => speak(headerWord)}>
              发音
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>

        {effectivePhrase && !isPhraseClick ? (
          <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-100">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">词组 / 固定搭配</div>
            <div className="mt-1 font-medium">{effectivePhrase.surface}</div>
            {effectivePhrase.text && effectivePhrase.text !== effectivePhrase.surface ? (
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">模板：{effectivePhrase.text}</div>
            ) : null}
            {phraseGloss.zh?.trim() ? (
              <div className="mt-2 text-xs text-zinc-800 dark:text-zinc-200">中文：{phraseGloss.zh.trim()}</div>
            ) : null}
            {phraseLoading ? (
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">词组释义查询中…</div>
            ) : phraseDict?.definition ? (
              <div className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">{phraseDict.definition}</div>
            ) : phraseGloss.reason?.trim() ? (
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">备注：{phraseGloss.reason.trim()}</div>
            ) : (
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">暂无词组释义（你可以先看单词释义）。</div>
            )}
          </div>
        ) : null}

        {/* 用户需求：点单词时不展示英文释义卡片（仅保留中文释义输入与收藏）。 */}

        <div className="mt-3 grid gap-3">
          <Input
            label="中文释义"
            placeholder="例如：意图；目的"
            value={meaningZh}
            onChange={(e) => {
              setMeaningTouched(true);
              setMeaningZh(e.target.value);
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => onSeek(phraseWordStart)}>
              {isPhraseClick ? "回放该词组" : "回放该词"}
            </Button>
            <Button
              type="button"
              disabled={Boolean(saved)}
              onClick={async () => {
                await add({
                  word: flashcardWord,
                  phonetic: dict?.phonetic ?? null,
                  part_of_speech: dict?.partOfSpeech ?? null,
                  meaning_zh: meaningZh || null,
                  example: segment.text,
                  video_id: video.id,
                  video_title: video.title,
                  segment_start: segment.start,
                  segment_end: segment.end,
                  word_start: phraseWordStart,
                  word_end: phraseWordEnd,
                  source: "curated",
                });
                onClose();
              }}
            >
              {saved ? "已收藏" : "收藏到闪卡"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

