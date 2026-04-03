import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mockSubtitles } from "@/lib/data/mock";
import type { PhraseSpan, SubtitleSegment, WordToken } from "@/lib/domain/types";
import { mergePhrasesSidecarIntoSegments, parsePhrasesSidecarJson } from "@/lib/domain/phraseSidecar";
import { getLocalSubtitlesByVideoId } from "@/lib/data/localAssets";
import { getVideoById } from "@/lib/data/videos";

type RemoteSubtitleFile = {
  segments?: Array<{
    start: number;
    end: number;
    en_text?: string;
    zh_text?: string;
    words?: Array<{ word: string; start: number; end: number; level?: string | null }>;
    phrases?: Array<{
      text?: string;
      reason?: string | null;
      zh?: string | null;
      wStart?: number;
      wEnd?: number;
    }>;
  }>;
};

function toWordToken(w: {
  word?: string;
  w?: string;
  start?: number;
  end?: number;
  s?: number;
  e?: number;
  level?: string | null;
}): WordToken {
  const word = w.word ?? w.w ?? "";
  const start = typeof w.start === "number" ? w.start : (w.s ?? 0);
  const end = typeof w.end === "number" ? w.end : (w.e ?? 0);
  return { w: word, s: start, e: end, level: w.level ?? null };
}

function mapPhrases(raw: unknown): PhraseSpan[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const phrases = raw
    .map((p) => {
      const pr = p as Record<string, unknown>;
      return {
        text: typeof pr.text === "string" ? pr.text : "",
        reason: typeof pr.reason === "string" ? pr.reason : null,
        zh: typeof pr.zh === "string" && pr.zh.trim() ? pr.zh.trim() : null,
        wStart: typeof pr.wStart === "number" ? pr.wStart : -1,
        wEnd: typeof pr.wEnd === "number" ? pr.wEnd : -1,
      };
    })
    .filter((p) => p.text && p.wStart >= 0 && p.wEnd >= p.wStart);
  return phrases.length > 0 ? phrases : undefined;
}

/**
 * DB / pipeline JSON often uses en_text + zh_text; UI expects text + zh.
 */
function normalizeStoredSubtitleSegment(s: unknown): SubtitleSegment {
  if (!s || typeof s !== "object") {
    return { start: 0, end: 0, text: "", zh: null };
  }
  const o = s as Record<string, unknown>;
  const start = typeof o.start === "number" ? o.start : 0;
  const end = typeof o.end === "number" ? o.end : 0;
  const text =
    typeof o.text === "string" && o.text.length > 0
      ? o.text
      : typeof o.en_text === "string"
        ? o.en_text
        : "";
  const zhRaw = o.zh ?? o.zh_text;
  const zh =
    typeof zhRaw === "string" && zhRaw.length > 0 ? zhRaw : null;

  const wordsRaw = o.words;
  const words: WordToken[] | undefined = Array.isArray(wordsRaw)
    ? wordsRaw.map((w) =>
        toWordToken(w as { word?: string; w?: string; start?: number; end?: number; s?: number; e?: number; level?: string | null }),
      )
    : undefined;

  const phrases = mapPhrases(o.phrases);

  return { start, end, text, zh, words, phrases };
}

function normalizeStoredSubtitleSegments(raw: unknown): SubtitleSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeStoredSubtitleSegment);
}

/** Supabase `content` may be a segment array or a full JSON file `{ segments: [...] }`. */
function coerceSubtitleSegmentArray(content: unknown): unknown[] | null {
  if (Array.isArray(content)) return content;
  if (content && typeof content === "object") {
    const seg = (content as Record<string, unknown>).segments;
    if (Array.isArray(seg)) return seg;
  }
  return null;
}

function mapRemoteSubtitleFile(parsed: RemoteSubtitleFile): SubtitleSegment[] {
  const segments = parsed.segments ?? [];
  return segments.map((s) => {
    const words: WordToken[] | undefined = (s.words ?? []).map(toWordToken);
    const phrases: PhraseSpan[] | undefined = Array.isArray(s.phrases)
      ? s.phrases
          .map((p) => ({
            text: typeof p.text === "string" ? p.text : "",
            reason: typeof p.reason === "string" ? p.reason : null,
            zh: typeof p.zh === "string" && p.zh.trim() ? p.zh.trim() : null,
            wStart: typeof p.wStart === "number" ? p.wStart : -1,
            wEnd: typeof p.wEnd === "number" ? p.wEnd : -1,
          }))
          .filter((p) => p.text && p.wStart >= 0 && p.wEnd >= p.wStart)
      : undefined;

    return {
      start: s.start,
      end: s.end,
      text: s.en_text ?? "",
      zh: s.zh_text ?? null,
      words,
      phrases,
    };
  });
}

/** 与主字幕同路径：优先 `*_phrases.json`，再尝试历史/导出用的 `*_phrases_batch.json`。 */
function derivePhrasesUrlsFromSubtitle(subtitleUrl: string): string[] {
  try {
    const u = new URL(subtitleUrl);
    if (!u.pathname.toLowerCase().endsWith(".json")) return [];
    const stem = u.pathname.replace(/\.json$/i, "");
    return ["_phrases.json", "_phrases_batch.json"].map((suf) => {
      const next = new URL(u.toString());
      next.pathname = `${stem}${suf}`;
      return next.toString();
    });
  } catch {
    return [];
  }
}

async function fetchPhrasesSidecarFromUrl(url: string | null | undefined) {
  const u = (url ?? "").trim();
  if (!u) return [];
  try {
    const res = await fetch(u, { cache: "no-store" });
    if (!res.ok) return [];
    return parsePhrasesSidecarJson(await res.json());
  } catch {
    return [];
  }
}

async function fetchPhrasesSidecarForVideo(video: {
  phrases_url?: string | null;
  subtitle_url?: string | null;
}) {
  const direct = await fetchPhrasesSidecarFromUrl(video.phrases_url ?? undefined);
  if (direct.length > 0) return direct;
  const sub = (video.subtitle_url ?? "").trim();
  if (!sub) return [];
  for (const url of derivePhrasesUrlsFromSubtitle(sub)) {
    const items = await fetchPhrasesSidecarFromUrl(url);
    if (items.length > 0) return items;
  }
  return [];
}

async function fetchFromVideoSubtitleUrl(videoId: string): Promise<SubtitleSegment[]> {
  const video = await getVideoById(videoId);
  if (!video?.subtitle_url) return [];
  try {
    const res = await fetch(video.subtitle_url, { cache: "no-store" });
    if (!res.ok) return [];
    const raw = (await res.json()) as RemoteSubtitleFile;
    let segs = mapRemoteSubtitleFile(raw);
    const items = await fetchPhrasesSidecarForVideo(video);
    if (items.length > 0) segs = mergePhrasesSidecarIntoSegments(segs, items);
    return segs;
  } catch {
    return [];
  }
}

export async function getSubtitlesByVideoId(videoId: string): Promise<SubtitleSegment[]> {
  if (videoId.startsWith("local__")) return await getLocalSubtitlesByVideoId(videoId);

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const fallback = await fetchFromVideoSubtitleUrl(videoId);
    if (fallback.length > 0) return fallback;
    return mockSubtitles[videoId] ?? [];
  }

  const { data, error } = await supabase
    .from("subtitles")
    .select("content")
    .eq("video_id", videoId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const rawSegments = coerceSubtitleSegmentArray(data?.content);
  if (rawSegments && rawSegments.length > 0) {
    return normalizeStoredSubtitleSegments(rawSegments);
  }
  return await fetchFromVideoSubtitleUrl(videoId);
}

