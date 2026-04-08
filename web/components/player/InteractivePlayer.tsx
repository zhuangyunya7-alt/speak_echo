"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubtitleSegment, Video, WordToken } from "@/lib/domain/types";
import { WordLookupPopover } from "@/components/player/WordLookupPopover";
import { addWatchSeconds } from "@/lib/record/client";
import { pickActive, resolveNavSegIndex, type ActiveWord } from "@/components/player/transcriptUtils";
import { TranscriptPane } from "@/components/player/TranscriptPane";
import { VideoPane } from "@/components/player/VideoPane";
import { useVocabularyLevels } from "@/components/player/vocabularyLevels";
import { addWatchSecondsSynced, markLearnedToday } from "@/lib/learning/sync";
import { DesktopVocabCards } from "@/components/player/DesktopVocabCards";
import { DesktopSceneTemplates } from "@/components/player/DesktopSceneTemplates";
import { resolveVocabDisplayFetchUrl, useVocabDisplay } from "@/components/player/useVocabDisplay";
import { useFlashcards } from "@/lib/flashcards/client";

/** play() may reject with AbortError when pause() or load interrupts; ignore so dev overlay stays clean. */
function playVideo(el: HTMLVideoElement) {
  const p = el.play();
  if (p === undefined) return;
  void p.catch((err) => {
    const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name;
    if (name === "AbortError") return;
  });
}

export function InteractivePlayer({
  video,
  subtitles,
  isAdmin,
}: {
  video: Video;
  subtitles: SubtitleSegment[];
  isAdmin: boolean;
}) {
  const mobileVideoRef = useRef<HTMLVideoElement | null>(null);
  const desktopVideoRef = useRef<HTMLVideoElement | null>(null);
  const mobileListRef = useRef<HTMLDivElement | null>(null);
  const desktopListRef = useRef<HTMLDivElement | null>(null);
  const mobileLineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const desktopLineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const mobilePlayerWrapRef = useRef<HTMLDivElement | null>(null);
  const desktopPlayerWrapRef = useRef<HTMLDivElement | null>(null);
  const watchRef = useRef<{ startedAt: number | null }>({ startedAt: null });

  const [isDesktop, setIsDesktop] = useState<boolean>(false);
  const [mobileVideoPaused, setMobileVideoPaused] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [active, setActive] = useState<ActiveWord>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [bilingualSubtitles, setBilingualSubtitles] = useState(true);
  const [loopMode, setLoopMode] = useState<"continuous" | "single">("continuous");
  const [singleRepeatCount, setSingleRepeatCount] = useState(3);
  const [autoNextSentence, setAutoNextSentence] = useState(true);
  const [lookup, setLookup] = useState<{
    open: boolean;
    word: WordToken | null;
    segment: SubtitleSegment | null;
    phrase: { text: string; reason?: string | null; zh?: string | null; wStart: number; wEnd: number; surface: string } | null;
    anchorRect: DOMRect | null;
  }>({ open: false, word: null, segment: null, phrase: null, anchorRect: null });

  const rates = useMemo(() => [0.5, 0.75, 1.0, 1.25, 1.5], []);
  const { ready: flashReady, cards, add, patch, byWord } = useFlashcards();

  const customFlashcard = useMemo(
    () => ({
      video: { id: video.id, title: video.title },
      addFlashcard: add,
      patchFlashcard: patch,
      byFlashcardWord: byWord,
    }),
    [video.id, video.title, add, patch, byWord],
  );

  const assetBase = useMemo(() => {
    if (video.video_url.startsWith("/videos/")) {
      const file = video.video_url.split("/").pop() ?? "";
      const dot = file.lastIndexOf(".");
      return dot >= 0 ? file.slice(0, dot) : file;
    }
    if (video.video_url.startsWith("/api/content-inbox/")) {
      const file = decodeURIComponent(video.video_url.split("/").pop() ?? "");
      const dot = file.lastIndexOf(".");
      return dot >= 0 ? file.slice(0, dot) : file;
    }
    return null;
  }, [video.video_url]);

  const vocabKeyOrUrl = video.vocab_url ? video.vocab_url : assetBase;
  const fallbackBase =
    video.id.startsWith("local__") ? video.id.replace(/^local__/, "") : null;
  // Always load vocab JSON so「本视频难词」与掌握度统计不依赖「彩色难词」开关。
  const { classifyWord } = useVocabularyLevels(
    vocabKeyOrUrl || fallbackBase,
    true,
    fallbackBase
  );

  const vocabDisplayFetchUrl = useMemo(
    () => resolveVocabDisplayFetchUrl(video, assetBase, fallbackBase),
    [video, assetBase, fallbackBase],
  );
  const { entries: vocabDisplayEntries } = useVocabDisplay(vocabDisplayFetchUrl);

  const loopModeRef = useRef<"continuous" | "single">("continuous");
  const repeatCountRef = useRef(3);
  const autoNextRef = useRef(true);
  const currentLoopSegRef = useRef<number | null>(null);
  const remainingRepeatsRef = useRef(0);
  const subtitlesRef = useRef<SubtitleSegment[]>(subtitles);
  const lastActiveRef = useRef<ActiveWord>(null);

  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  useEffect(() => {
    repeatCountRef.current = singleRepeatCount;
  }, [singleRepeatCount]);

  useEffect(() => {
    autoNextRef.current = autoNextSentence;
  }, [autoNextSentence]);

  useEffect(() => {
    subtitlesRef.current = subtitles;
  }, [subtitles]);

  const normalizeWord = useCallback((word: string) => {
    return word
      .toLowerCase()
      .replace(/^[^a-z]+/i, "")
      .replace(/[^a-z]+$/i, "");
  }, []);

  const { difficultCount, masteredCount } = useMemo(() => {
    const difficultSet = new Set<string>();
    for (const seg of subtitles) {
      const words = seg.words ?? [];
      for (const w of words) {
        const inList = classifyWord(w.w);
        const fromToken =
          w.level === "hard" ||
          w.level === "cet4" ||
          w.level === "cet6" ||
          w.level === "ielts";
        if (!inList && !fromToken) continue;
        const key = normalizeWord(w.w);
        if (!key) continue;
        difficultSet.add(key);
      }
    }

    if (!flashReady || difficultSet.size === 0) {
      return { difficultCount: difficultSet.size, masteredCount: 0 };
    }

    const mastered = cards.filter((c) => {
      if (c.video_id !== video.id) return false;
      const key = normalizeWord(c.word);
      return key && difficultSet.has(key);
    }).length;

    return { difficultCount: difficultSet.size, masteredCount: mastered };
  }, [cards, classifyWord, flashReady, normalizeWord, subtitles, video.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(Boolean(mq.matches));
    update();
    mq.addEventListener("change", update);
    return () => {
      mq.removeEventListener("change", update);
    };
  }, []);

  /** 竖屏：与原生控制条同步暂停态，用于中间播放提示 */
  useEffect(() => {
    if (isDesktop) return;
    const el = mobileVideoRef.current;
    if (!el) return;
    const sync = () => setMobileVideoPaused(el.paused);
    sync();
    el.addEventListener("play", sync);
    el.addEventListener("pause", sync);
    return () => {
      el.removeEventListener("play", sync);
      el.removeEventListener("pause", sync);
    };
  }, [isDesktop, video.video_url]);

  const getVideoEl = useCallback(() => {
    return (isDesktop ? desktopVideoRef.current : mobileVideoRef.current) ?? null;
  }, [isDesktop]);

  const getTranscriptEls = useCallback(() => {
    return isDesktop
      ? { container: desktopListRef.current, lines: desktopLineRefs.current }
      : { container: mobileListRef.current, lines: mobileLineRefs.current };
  }, [isDesktop]);

  useEffect(() => {
    const ms = 45_000;
    const t = window.setTimeout(() => void markLearnedToday(), ms);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = getVideoEl();
    if (!el) return;
    el.playbackRate = playbackRate;
  }, [getVideoEl, playbackRate]);

  useEffect(() => {
    let raf = 0;
    const el = getVideoEl();
    if (!el) return;

    const tick = () => {
      const t = el.currentTime || 0;
      const subs = subtitlesRef.current;
      const picked = pickActive(subs, t);
      const prev = lastActiveRef.current;
      const same =
        (prev === null && picked === null) ||
        (prev !== null &&
          picked !== null &&
          prev.segIndex === picked.segIndex &&
          prev.wordIndex === picked.wordIndex);
      if (!same) {
        lastActiveRef.current = picked;
        setActive(picked);
      }

      const mode = loopModeRef.current;
      const segIndex = currentLoopSegRef.current;
      if (!Number.isFinite(t) || !subs.length) {
        raf = requestAnimationFrame(tick);
        return;
      }

      if (mode === "single" && segIndex != null && segIndex >= 0 && segIndex < subs.length) {
        const seg = subs[segIndex]!;
        const end = seg.end;
        if (t >= end - 0.08) {
          if (remainingRepeatsRef.current > 1) {
            remainingRepeatsRef.current -= 1;
            el.currentTime = Math.max(0, seg.start);
          } else {
            const autoNext = autoNextRef.current;
            const nextIndex = segIndex + 1;
            if (autoNext && nextIndex < subs.length) {
              currentLoopSegRef.current = nextIndex;
              remainingRepeatsRef.current = repeatCountRef.current;
              const nextSeg = subs[nextIndex]!;
              el.currentTime = Math.max(0, nextSeg.start);
            } else {
              currentLoopSegRef.current = null;
              remainingRepeatsRef.current = 0;
            }
          }
        }
      } else if (mode === "continuous") {
        // 连播：不根据字幕边界改 currentTime，否则易与真实音画不同步或遇重叠时间轴时反复 seek 到「下句起点」卡死首句。
        // 高亮与列表滚动已由上面 setActive(pickActive(subtitles, t)) 跟进度走。
        currentLoopSegRef.current = picked?.segIndex ?? null;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getVideoEl]);

  useEffect(() => {
    const el = getVideoEl();
    if (!el) return;

    const onPlay = () => {
      if (watchRef.current.startedAt == null) watchRef.current.startedAt = performance.now();
    };
    const onPause = () => {
      const started = watchRef.current.startedAt;
      if (started == null) return;
      const delta = Math.max(0, performance.now() - started);
      watchRef.current.startedAt = null;
      addWatchSeconds(delta / 1000);
      void addWatchSecondsSynced(delta / 1000);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      onPause();
    };
  }, [getVideoEl]);

  useEffect(() => {
    if (!active) return;
    if (!autoScroll) return;
    const { container, lines } = getTranscriptEls();
    const node = lines[active.segIndex];
    if (!node || !container) return;

    const cTop = container.scrollTop;
    const cHeight = container.clientHeight;
    const nTop = node.offsetTop;
    const nHeight = node.clientHeight;

    const target = isDesktop
      ? nTop - cHeight / 2 + nHeight / 2
      : (() => {
          // 竖屏：当前句顶对齐字幕区可视区域顶部（第一条可见即当前句）
          const containerRect = container.getBoundingClientRect();
          const nodeRect = node.getBoundingClientRect();
          const deltaPx = nodeRect.top - containerRect.top;
          const raw = container.scrollTop + deltaPx;
          const max = Math.max(0, container.scrollHeight - container.clientHeight);
          return Math.max(0, Math.min(max, raw));
        })();
    const delta = Math.abs(target - cTop);
    if (delta < 12) return;

    if (isDesktop) {
      container.scrollTo({ top: target, behavior: "smooth" });
    } else {
      // Mobile browsers can be flaky with smooth scrolling inside nested overflow containers.
      container.scrollTop = target;
    }
  }, [active, autoScroll, getTranscriptEls, isDesktop]);

  const seekTo = useCallback((t: number, segIndex?: number) => {
    const el = getVideoEl();
    if (!el) return;
    if (typeof segIndex === "number") {
      if (loopModeRef.current === "single") {
        currentLoopSegRef.current = segIndex;
        remainingRepeatsRef.current = repeatCountRef.current;
      } else {
        currentLoopSegRef.current = segIndex;
        remainingRepeatsRef.current = 0;
      }
    }
    el.currentTime = Math.max(0, t);
    playVideo(el);
  }, [getVideoEl]);

  const scrollPlayerIntoView = useCallback(() => {
    const wrap = isDesktop ? desktopPlayerWrapRef.current : mobilePlayerWrapRef.current;
    wrap?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isDesktop]);

  const seekFromVocabCard = useCallback(
    (t: number, segIndex?: number) => {
      seekTo(t, segIndex);
      requestAnimationFrame(() => scrollPlayerIntoView());
    },
    [seekTo, scrollPlayerIntoView],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const subs = subtitlesRef.current;
      if (!subs.length) return;
      e.preventDefault();
      const el = getVideoEl();
      const tNow = el?.currentTime ?? 0;
      const hint = lastActiveRef.current;
      const base = resolveNavSegIndex(subs, tNow, hint);
      const nextIdx =
        e.key === "ArrowUp" ? Math.max(0, base - 1) : Math.min(subs.length - 1, base + 1);
      const seg = subs[nextIdx];
      if (!seg) return;
      seekTo(seg.start, nextIdx);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [getVideoEl, seekTo]);

  const openLookup = useCallback(
    (
      word: WordToken,
      seg: SubtitleSegment,
      rect: DOMRect,
      phrase: { text: string; reason?: string | null; zh?: string | null; wStart: number; wEnd: number; surface: string } | null,
    ) => {
    void markLearnedToday();
      setLookup({ open: true, word, segment: seg, phrase, anchorRect: rect });
    },
    [],
  );

  return (
    <div className="space-y-5">
      {/* Vertical layout: mobile / portrait (< lg) */}
      <div className="grid gap-4 lg:hidden">
        <div
          ref={mobilePlayerWrapRef}
          className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-black dark:border-zinc-800"
        >
          <video
            ref={mobileVideoRef}
            className="h-full w-full"
            controls
            playsInline
            preload="metadata"
            src={video.video_url}
          />
          {/*
            原生 controls 会吃掉大面积点击。在底部控制条之上铺透明层：点画面区暂停/继续；
            底部约 3.5rem 留给进度条与小按钮，不挡拖动进度。
          */}
          <button
            type="button"
            aria-label={mobileVideoPaused ? "播放" : "暂停"}
            className="absolute inset-x-0 top-0 z-[1] cursor-pointer border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const el = mobileVideoRef.current;
              if (!el) return;
              if (el.paused) playVideo(el);
              else el.pause();
            }}
          />
          {mobileVideoPaused ? (
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-center justify-center"
              style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }}
              aria-hidden
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white shadow-lg">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </div>
          ) : null}
        </div>
        <TranscriptPane
          subtitles={subtitles}
          active={active}
          listRef={mobileListRef}
          lineRefs={mobileLineRefs}
          autoScroll={autoScroll}
          onToggleAutoScroll={() => setAutoScroll((v) => !v)}
          bilingualSubtitles={bilingualSubtitles}
          onToggleBilingualSubtitles={() => setBilingualSubtitles((v) => !v)}
          loopMode={loopMode}
          onChangeLoopMode={setLoopMode}
          singleRepeatCount={singleRepeatCount}
          onChangeSingleRepeatCount={setSingleRepeatCount}
          autoNextSentence={autoNextSentence}
          onToggleAutoNextSentence={() => setAutoNextSentence((v) => !v)}
          classifyWord={classifyWord}
          onSeek={(t, idx) => seekTo(t, idx)}
          onWordClick={(w, seg, rect, phrase) => openLookup(w, seg, rect, phrase)}
          listMaxHeightClass="max-h-[58dvh]"
          customFlashcard={customFlashcard}
        />
      </div>

      {/* Desktop layout: side-by-side grid (lg+) */}
      <div className="hidden lg:grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <div ref={desktopPlayerWrapRef} className="min-w-0">
          <VideoPane
            video={video}
            videoRef={desktopVideoRef}
            playbackRate={playbackRate}
            rates={rates}
            onChangeRate={setPlaybackRate}
            localAssetBase={assetBase}
            canEdit={isAdmin}
          />
        </div>
        <TranscriptPane
          subtitles={subtitles}
          active={active}
          listRef={desktopListRef}
          lineRefs={desktopLineRefs}
          autoScroll={autoScroll}
          onToggleAutoScroll={() => setAutoScroll((v) => !v)}
          bilingualSubtitles={bilingualSubtitles}
          onToggleBilingualSubtitles={() => setBilingualSubtitles((v) => !v)}
          loopMode={loopMode}
          onChangeLoopMode={setLoopMode}
          singleRepeatCount={singleRepeatCount}
          onChangeSingleRepeatCount={setSingleRepeatCount}
          autoNextSentence={autoNextSentence}
          onToggleAutoNextSentence={() => setAutoNextSentence((v) => !v)}
          classifyWord={classifyWord}
          onSeek={(t, idx) => seekTo(t, idx)}
          onWordClick={(w, seg, rect, phrase) => openLookup(w, seg, rect, phrase)}
          customFlashcard={customFlashcard}
        />
      </div>

      {isDesktop && difficultCount > 0 ? (
        <section className="hidden lg:block rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          <div className="flex items-center justify-between">
            <div className="font-semibold">本视频难词掌握度</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {masteredCount} / {difficultCount}
            </div>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-900/40">
            <div
              className="h-2 rounded-full bg-[#602D89] transition-[width]"
              style={{
                width: `${Math.min(100, (difficultCount ? (masteredCount / difficultCount) * 100 : 0)).toFixed(1)}%`,
              }}
            />
          </div>
        </section>
      ) : null}

      <DesktopVocabCards
        videoId={video.id}
        subtitles={subtitles}
        classifyWord={classifyWord}
        vocabDisplay={vocabDisplayEntries}
        onSeek={seekFromVocabCard}
      />
      <DesktopSceneTemplates subtitles={subtitles} onSeek={seekTo} />

      <WordLookupPopover
        open={lookup.open}
        anchorRect={lookup.anchorRect}
        word={lookup.word}
        segment={lookup.segment}
        phrase={lookup.phrase}
        video={video}
        vocabDisplay={vocabDisplayEntries}
        onClose={() => setLookup({ open: false, word: null, segment: null, phrase: null, anchorRect: null })}
        onSeek={(t) => seekTo(t)}
      />
    </div>
  );
}
