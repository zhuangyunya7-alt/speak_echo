"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SubtitleSegment } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeFlashcardWordSurface } from "@/lib/text/flashcardWord";
import { fetchExternalDictHints } from "@/lib/flashcards/fetchExternalDictHints";
import {
  selectionMatchesCuratedHighlight,
  timeRangeForSelection,
} from "@/components/player/transcriptCustomFlashcardUtils";
import type { Flashcard } from "@/lib/domain/types";

async function translateToZh(text: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  const res = await fetch(`/api/translate-zh?text=${encodeURIComponent(t)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { translated?: string };
  const translated = json.translated?.trim() ?? "";
  return translated || null;
}

type PanelState = {
  segIndex: number;
  surface: string;
  anchorTop: number;
  anchorLeft: number;
};

export function TranscriptCustomFlashcardPanel({
  listRef,
  subtitles,
  classifyWord,
  video,
  byFlashcardWord,
  addFlashcard,
  patchFlashcard,
}: {
  listRef: React.RefObject<HTMLDivElement | null>;
  subtitles: SubtitleSegment[];
  classifyWord: (word: string) => boolean;
  video: { id: string; title: string };
  byFlashcardWord: (word: string) => Flashcard | null;
  addFlashcard: (draft: Omit<Flashcard, "id" | "user_id" | "created_at">) => Promise<string>;
  patchFlashcard: (id: string, patch: Partial<Flashcard>) => Promise<void>;
}) {
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [meaningZh, setMeaningZh] = useState("");
  const [translating, setTranslating] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const skipNextDocMouseDown = useRef(false);

  const closePanel = useCallback(() => {
    setPanel(null);
    setMeaningZh("");
    window.getSelection()?.removeAllRanges();
  }, []);

  const surfaceLemma = panel ? normalizeFlashcardWordSurface(panel.surface) || panel.surface.trim() : "";
  const alreadySaved = panel && surfaceLemma ? Boolean(byFlashcardWord(surfaceLemma)) : false;
  const curatedHint =
    panel != null && selectionMatchesCuratedHighlight(subtitles[panel.segIndex]!, panel.surface, classifyWord);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, closePanel]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (skipNextDocMouseDown.current) {
        skipNextDocMouseDown.current = false;
        return;
      }
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      closePanel();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [closePanel, listRef]);

  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;

    function onMouseUp() {
      requestAnimationFrame(() => {
        const root = listRef.current;
        if (!root) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        const range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;

        const raw = sel.toString().replace(/\u00a0/g, " ").trim();
        if (raw.length < 1 || raw.length > 200) return;

        let el: HTMLElement | null =
          range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? (range.commonAncestorContainer.parentElement as HTMLElement | null)
            : (range.commonAncestorContainer as HTMLElement);
        const row = el?.closest("[data-seg-index]") as HTMLElement | null;
        if (!row) return;
        const idxStr = row.getAttribute("data-seg-index");
        const segIndex = idxStr != null ? Number(idxStr) : NaN;
        if (!Number.isFinite(segIndex) || segIndex < 0 || segIndex >= subtitles.length) return;

        const rect = range.getBoundingClientRect();
        if (rect.width < 2 && rect.height < 2) return;

        skipNextDocMouseDown.current = true;
        setMeaningZh("");
        setPanel({
          segIndex,
          surface: raw,
          anchorTop: rect.bottom + 6,
          anchorLeft: rect.left,
        });
      });
    }

    listEl.addEventListener("mouseup", onMouseUp);
    return () => listEl.removeEventListener("mouseup", onMouseUp);
  }, [listRef, subtitles.length]);

  const onTranslateHint = async () => {
    if (!panel) return;
    setTranslating(true);
    try {
      const lemma = normalizeFlashcardWordSurface(panel.surface) || panel.surface.trim();
      const zh = await translateToZh(lemma);
      if (zh) setMeaningZh(zh);
    } finally {
      setTranslating(false);
    }
  };

  const onSave = async () => {
    if (!panel || !surfaceLemma || alreadySaved) return;
    const seg = subtitles[panel.segIndex]!;
    const { word_start, word_end } = timeRangeForSelection(seg, panel.surface);
    const id = await addFlashcard({
      word: surfaceLemma,
      phonetic: null,
      part_of_speech: null,
      meaning_zh: meaningZh.trim() || null,
      example: seg.text ?? null,
      video_id: video.id,
      video_title: video.title,
      segment_start: seg.start,
      segment_end: seg.end,
      word_start,
      word_end,
      source: "custom",
    });
    closePanel();
    void (async () => {
      const hints = await fetchExternalDictHints(surfaceLemma);
      if (!hints || (!hints.phonetic && !hints.part_of_speech)) return;
      await patchFlashcard(id, {
        phonetic: hints.phonetic,
        part_of_speech: hints.part_of_speech,
      });
    })();
  };

  if (!panel) return null;

  const maxLeft = typeof window !== "undefined" ? Math.max(12, window.innerWidth - 12 - 360) : 12;
  const left = Math.min(panel.anchorLeft, maxLeft);

  return (
    <div
      ref={panelRef}
      className="fixed z-[100] w-[min(360px,calc(100vw-24px))] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
      style={{ top: panel.anchorTop, left }}
      role="dialog"
      aria-label="自定义闪卡"
    >
      <div className="text-xs font-semibold text-[#602D89] dark:text-[#C8A6EB]">划词收藏</div>
      <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{surfaceLemma || panel.surface}</div>
      {curatedHint ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          该片段已在难词/词组中高亮，也可直接点选词形使用词包释义收藏。
        </p>
      ) : null}
      {alreadySaved ? (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">该词条已在闪卡中。</p>
      ) : null}

      <div className="mt-3 space-y-2">
        <Input
          label="中文释义"
          placeholder="可手动填写，或使用下方参考"
          value={meaningZh}
          onChange={(e) => setMeaningZh(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={translating} onClick={() => void onTranslateHint()}>
            {translating ? "翻译中…" : "翻译参考"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={closePanel}>
            取消
          </Button>
          <Button type="button" size="sm" disabled={alreadySaved || !surfaceLemma} onClick={() => void onSave()}>
            保存到闪卡
          </Button>
        </div>
      </div>
    </div>
  );
}
