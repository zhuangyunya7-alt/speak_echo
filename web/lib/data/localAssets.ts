import path from "path";
import { readdir, readFile, stat } from "fs/promises";

import type { PhraseSpan, SubtitleSegment, Video, WordToken } from "@/lib/domain/types";
import { mergePhrasesSidecarIntoSegments, parsePhrasesSidecarJson } from "@/lib/domain/phraseSidecar";
import { contentInboxDir } from "@/lib/paths/contentInbox";
import { resolvePlayableMediaUrl } from "@/lib/media/tencentCos";

type LocalSubtitleFile = {
  meta?: { source_url?: string; video_id?: string };
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

type LocalVideoMetaFile = {
  title?: string;
  level?: string;
  category?: string;
  categories?: string[];
  author?: string;
  description?: string;
  published_at?: string;
  video_url?: string;
  subtitle_url?: string;
  vocab_url?: string;
  vocab_display_url?: string;
  phrases_url?: string;
  meta_url?: string;
  duration_sec?: number;
};

function inferDurationSecFromSubtitleFile(subtitle: LocalSubtitleFile | null): number | null {
  const segments = subtitle?.segments ?? [];
  if (segments.length === 0) return null;
  let maxEnd = 0;
  for (const seg of segments) {
    if (typeof seg.end === "number" && Number.isFinite(seg.end)) {
      if (seg.end > maxEnd) maxEnd = seg.end;
    }
  }
  if (maxEnd <= 0) return null;
  return Math.ceil(maxEnd);
}

function inboxDir() {
  return contentInboxDir();
}

function toLocalId(base: string) {
  return `local__${base}`;
}

function fromLocalId(id: string) {
  return id.startsWith("local__") ? id.slice("local__".length) : null;
}

function extless(name: string) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(0, idx) : name;
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function mergePhrasesSidecarFromInbox(base: string, segments: SubtitleSegment[]): Promise<SubtitleSegment[]> {
  for (const suffix of ["_phrases.json", "_phrases_batch.json"] as const) {
    const phrasePath = path.join(inboxDir(), `${base}${suffix}`);
    const raw = await readOptionalJson<unknown>(phrasePath);
    const items = parsePhrasesSidecarJson(raw);
    if (items.length > 0) return mergePhrasesSidecarIntoSegments(segments, items);
  }
  return segments;
}

export async function listLocalVideos(): Promise<Video[]> {
  const dir = inboxDir();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const media = names.filter((n) => /\.(mp4|webm|mov|m4v)$/i.test(n));

  const out: Video[] = [];
  for (const file of media) {
    const base = extless(file);
    const videoPath = path.join(dir, file);
    const st = await stat(videoPath).catch(() => null);
    const jsonPath = path.join(inboxDir(), `${base}.json`);
    const subtitle = await readOptionalJson<LocalSubtitleFile>(jsonPath);
    const subtitleMeta = subtitle?.meta;

    const metaPath = path.join(inboxDir(), `${base}.meta.json`);
    const metaFile = await readOptionalJson<LocalVideoMetaFile>(metaPath);
    const inferredDuration = inferDurationSecFromSubtitleFile(subtitle);
    const durationSec =
      typeof metaFile?.duration_sec === "number" && Number.isFinite(metaFile.duration_sec) && metaFile.duration_sec > 0
        ? Math.round(metaFile.duration_sec)
        : inferredDuration;

    const inboxVideoUrl = `/api/content-inbox/${encodeURIComponent(file)}`;

    out.push({
      id: toLocalId(base),
      title: metaFile?.title ?? subtitleMeta?.video_id ?? base,
      cover_url: "", // generated on client from first frame
      video_url: metaFile?.video_url ?? inboxVideoUrl,
      subtitle_url: metaFile?.subtitle_url ?? null,
      vocab_url: metaFile?.vocab_url ?? null,
      vocab_display_url: metaFile?.vocab_display_url ?? null,
      phrases_url: metaFile?.phrases_url ?? null,
      meta_url: metaFile?.meta_url ?? null,
      author: metaFile?.author ?? "本地视频",
      level: metaFile?.level ?? "—",
      category: metaFile?.category ?? metaFile?.categories?.[0] ?? "本地视频",
      categories: metaFile?.categories ?? (metaFile?.category ? [metaFile.category] : null),
      duration_sec: durationSec,
      published_at: metaFile?.published_at ?? st?.mtime.toISOString() ?? null,
      description: metaFile?.description ?? (subtitleMeta?.source_url ? `Source: ${subtitleMeta.source_url}` : null),
    });
  }

  return out;
}

export async function getLocalVideoById(id: string): Promise<Video | null> {
  const base = fromLocalId(id);
  if (!base) return null;
  const all = await listLocalVideos();
  return all.find((v) => v.id === id) ?? null;
}

export async function getLocalSubtitlesByVideoId(id: string): Promise<SubtitleSegment[]> {
  const base = fromLocalId(id);
  if (!base) return [];
  const metaPath = path.join(inboxDir(), `${base}.meta.json`);
  const metaFile = await readOptionalJson<LocalVideoMetaFile>(metaPath);

  const jsonPath = path.join(inboxDir(), `${base}.json`);

  if (metaFile?.subtitle_url) {
    try {
      const subtitleUrl =
        (await resolvePlayableMediaUrl(metaFile.subtitle_url)) ?? metaFile.subtitle_url;
      const res = await fetch(subtitleUrl, { cache: "no-store" });
      if (res.ok) {
        const parsed = (await res.json()) as LocalSubtitleFile;
        const mapped = mapSubtitleFile(parsed);
        const hasWords = mapped.some((seg) => (seg.words ?? []).length > 0);
        if (hasWords) {
          // If remote subtitle has word-level timing but no phrases,
          // merge phrases from local subtitle file (if present) by (start,end) match.
          const remoteHasPhrases = mapped.some((seg) => (seg.phrases ?? []).length > 0);
          if (!remoteHasPhrases) {
            const localParsed = await readOptionalJson<LocalSubtitleFile>(jsonPath);
            if (localParsed) {
              const localMapped = mapSubtitleFile(localParsed);
              const phraseByKey = new Map<string, SubtitleSegment["phrases"]>();
              for (const s of localMapped) {
                if (!s.phrases || s.phrases.length === 0) continue;
                phraseByKey.set(`${s.start}|${s.end}`, s.phrases);
              }
              const merged = mapped.map((s) => {
                const phrases = phraseByKey.get(`${s.start}|${s.end}`) ?? s.phrases;
                return phrases && phrases.length > 0 ? { ...s, phrases } : s;
              });
              return mergePhrasesSidecarFromInbox(base, merged);
            }
          }
          return mergePhrasesSidecarFromInbox(base, mapped);
        }
      }
    } catch {
      /* fallthrough to local */
    }
  }

  const parsed = await readOptionalJson<LocalSubtitleFile>(jsonPath);
  if (!parsed) return [];
  const mapped = mapSubtitleFile(parsed);
  return mergePhrasesSidecarFromInbox(base, mapped);
}

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

function mapSubtitleFile(parsed: LocalSubtitleFile): SubtitleSegment[] {
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

