"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFlashcards } from "@/lib/flashcards/client";
import { normalizeVocabLemma } from "@/lib/domain/vocabDisplay";

function posZh(pos?: string | null) {
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

type VideoContext = {
  segmentZhByStart: Record<string, string>;
  vocabZhByLemma: Record<string, { zh: string; pos?: string }>;
  phraseZhByText: Record<string, string>;
};

function startKey(v?: number | null) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  return Number(v).toFixed(3);
}

function normalizePhraseKey(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^[^a-z]+/i, "")
    .replace(/[^a-z]+$/i, "")
    .replace(/\s+/g, " ");
}

function hasLeadingPosPrefix(text: string) {
  return /^\s*[（(]\s*(名词|动词|形容词|副词|介词|代词|连词|感叹词|限定词)\s*[)）]/.test(text);
}

export function FlashcardsClient() {
  const { ready, cards, remove } = useFlashcards();
  const [mode, setMode] = useState<"list" | "practice">("list");
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [videoFilter, setVideoFilter] = useState<string>("ALL");
  const [showMeaningByCard, setShowMeaningByCard] = useState<Record<string, boolean>>({});
  const [ctxByVideo, setCtxByVideo] = useState<Record<string, VideoContext>>({});

  const videoOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cards) {
      const id = c.video_id ?? "";
      if (!id) continue;
      if (!map.has(id)) map.set(id, c.video_title ?? id);
    }
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [cards]);

  useEffect(() => {
    if (videoFilter === "ALL") return;
    if (!videoOptions.some((v) => v.id === videoFilter)) setVideoFilter("ALL");
  }, [videoFilter, videoOptions]);

  useEffect(() => {
    let cancelled = false;
    const ids = Array.from(new Set(cards.map((c) => c.video_id).filter((x): x is string => Boolean(x))));
    if (ids.length === 0) return;
    (async () => {
      const entries: Array<[string, VideoContext]> = [];
      for (const id of ids) {
        if (ctxByVideo[id]) continue;
        try {
          const res = await fetch(`/api/flashcards-context?videoId=${encodeURIComponent(id)}`, { cache: "no-store" });
          if (!res.ok) continue;
          const json = (await res.json()) as {
            segmentZhByStart?: Record<string, string>;
            vocabZhByLemma?: Record<string, { zh: string; pos?: string }>;
            phraseZhByText?: Record<string, string>;
          };
          entries.push([
            id,
            {
              segmentZhByStart: json.segmentZhByStart ?? {},
              vocabZhByLemma: json.vocabZhByLemma ?? {},
              phraseZhByText: json.phraseZhByText ?? {},
            },
          ]);
        } catch {
          // keep empty context fallback
        }
      }
      if (cancelled || entries.length === 0) return;
      setCtxByVideo((prev) => {
        const next = { ...prev };
        for (const [id, ctx] of entries) next[id] = ctx;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [cards, ctxByVideo]);

  const filteredCards = useMemo(() => {
    if (videoFilter === "ALL") return cards;
    return cards.filter((c) => c.video_id === videoFilter);
  }, [cards, videoFilter]);

  useEffect(() => {
    if (idx >= filteredCards.length) setIdx(0);
  }, [filteredCards.length, idx]);

  const current = useMemo(() => filteredCards[idx] ?? null, [filteredCards, idx]);

  const removeCurrentCard = () => {
    if (!current) return;
    void remove(current.id);
  };

  const markCurrentAsMastered = () => {
    if (!current) return;
    // "已掌握": remove current card, then keep index so next card fills this slot.
    setFlipped(false);
    void remove(current.id);
  };

  const displayMeaning = (card: (typeof cards)[number]) => {
    const word = card.word;
    const meaningZh = card.meaning_zh;
    const pos = card.part_of_speech;
    const own = meaningZh?.trim();
    if (own) {
      const p = posZh(pos);
      if (!p || hasLeadingPosPrefix(own)) return own;
      return `（${p}）${own}`;
    }
    const vid = card.video_id ?? "";
    const key = normalizeVocabLemma(word);
    const fromVocab = vid && key ? ctxByVideo[vid]?.vocabZhByLemma?.[key] : undefined;
    if (fromVocab?.zh?.trim()) {
      const p = posZh(pos) || posZh(fromVocab.pos);
      if (!p || hasLeadingPosPrefix(fromVocab.zh)) return fromVocab.zh;
      return `（${p}）${fromVocab.zh}`;
    }
    const phraseKey = normalizePhraseKey(word);
    const phraseZh = vid && phraseKey ? ctxByVideo[vid]?.phraseZhByText?.[phraseKey] : "";
    if (phraseZh) {
      return phraseZh;
    }
    return "（未填写中文释义）";
  };

  const displayExampleZh = (card: (typeof cards)[number]) => {
    const vid = card.video_id ?? "";
    if (!vid) return "";
    const k = startKey(card.segment_start);
    if (!k) return "";
    return ctxByVideo[vid]?.segmentZhByStart?.[k] ?? "";
  };

  if (!ready) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        加载中…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">闪卡</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            你从视频里收藏的生词。可以在语境中练习，随时回到原片段复习。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={mode === "list" ? "primary" : "ghost"} onClick={() => setMode("list")}>
            列表
          </Button>
          <Button
            variant={mode === "practice" ? "primary" : "ghost"}
            disabled={cards.length === 0}
            onClick={() => {
              setMode("practice");
              setIdx(0);
              setFlipped(false);
            }}
          >
            练习
          </Button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <p>还没有闪卡。打开一个视频，点击字幕里的难词即可收藏。</p>
          <p className="mt-2">也可以在英文字幕上划选词句，添加「自定义闪卡」。</p>
        </div>
      ) : mode === "list" ? (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">视频库</div>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => setVideoFilter("ALL")}
                className={[
                  "w-full rounded-lg border px-3 py-2 text-left text-sm",
                  videoFilter === "ALL"
                    ? "border-[#602D89]/40 bg-[#602D89]/10 text-[#602D89] dark:text-[#C8A6EB]"
                    : "border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200",
                ].join(" ")}
              >
                不限（{cards.length}）
              </button>
              {videoOptions.map((v) => {
                const count = cards.filter((c) => c.video_id === v.id).length;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVideoFilter(v.id)}
                    className={[
                      "w-full rounded-lg border px-3 py-2 text-left text-sm",
                      videoFilter === v.id
                        ? "border-[#602D89]/40 bg-[#602D89]/10 text-[#602D89] dark:text-[#C8A6EB]"
                        : "border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200",
                    ].join(" ")}
                    title={v.title}
                  >
                    <div className="line-clamp-2">{v.title}</div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{count} 张</div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredCards.map((c) => {
              const showMeaning = Boolean(showMeaningByCard[c.id]);
              const exampleZh = displayExampleZh(c);
              return (
                <div
                  key={c.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">{c.word}</span>
                        {c.source === "custom" ? (
                          <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
                            自定义
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {c.phonetic ? <span>{c.phonetic}</span> : null}
                        {c.part_of_speech ? (
                          <span className="rounded-full border border-zinc-200 px-2 py-0.5 dark:border-zinc-700">
                            {posZh(c.part_of_speech)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => remove(c.id)}>
                      移除
                    </Button>
                  </div>

                  {showMeaning ? (
                    <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-200">
                      {displayMeaning(c)}
                    </div>
                  ) : null}

                  {c.example ? (
                    <div className="mt-2 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">例句：{c.example}</div>
                  ) : null}
                  {showMeaning && exampleZh ? (
                    <div className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">例句中文：{exampleZh}</div>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900/60"
                      onClick={() =>
                        setShowMeaningByCard((prev) => ({ ...prev, [c.id]: !prev[c.id] }))
                      }
                      aria-label={showMeaning ? "隐藏中文释义" : "显示中文释义"}
                      title={showMeaning ? "隐藏中文释义" : "显示中文释义"}
                    >
                      {showMeaning ? "🙈" : "👁"}
                    </button>
                    {c.video_title ? (
                      <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">来源：{c.video_title}</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <div>
                第 {idx + 1} / {filteredCards.length} 张
              </div>
              {current?.video_title ? <div className="truncate">来源：{current.video_title}</div> : null}
            </div>

            <button
              type="button"
              onClick={() => setFlipped((v) => !v)}
              className="mt-4 w-full rounded-2xl border border-zinc-200 bg-zinc-50 p-8 text-left transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/30 dark:hover:bg-zinc-900/50"
            >
              {!current ? null : !flipped ? (
                <div>
                  <div className="text-2xl font-semibold tracking-tight">{current.word}</div>
                  <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {current.example ?? "点击翻面查看释义"}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">释义</div>
                  <div className="mt-2 text-lg">
                    {displayMeaning(current)}
                  </div>
                  {current.part_of_speech || current.phonetic ? (
                    <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {[current.part_of_speech, current.phonetic].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                </div>
              )}
            </button>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setFlipped(false);
                  setIdx((i) => Math.max(0, i - 1));
                }}
                disabled={idx === 0}
              >
                上一个
              </Button>
              <Button
                onClick={() => {
                  setFlipped(false);
                  setIdx((i) => Math.min(filteredCards.length - 1, i + 1));
                }}
                disabled={idx === filteredCards.length - 1}
              >
                下一个
              </Button>
              <Button variant="danger" onClick={removeCurrentCard}>
                误收藏/清理
              </Button>
              <Button variant="ghost" onClick={markCurrentAsMastered}>
                认识
              </Button>
              <Button variant="ghost" onClick={() => setFlipped(true)}>
                不确定
              </Button>
            </div>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            提示：MVP 暂未实现间隔重复算法；这些按钮用于你自己做记忆反馈。
          </div>
        </div>
      )}
    </div>
  );
}

