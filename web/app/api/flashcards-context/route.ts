import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readdir, readFile } from "fs/promises";

import { getSubtitlesByVideoId } from "@/lib/data/subtitles";
import { getVideoById } from "@/lib/data/videos";
import { normalizePhraseSidecarZhReason } from "@/lib/domain/phraseSidecar";
import { parseVocabDisplayFile } from "@/lib/domain/vocabDisplay";
import { contentInboxDir } from "@/lib/paths/contentInbox";

type ContextPayload = {
  videoId: string;
  segmentZhByStart: Record<string, string>;
  vocabZhByLemma: Record<string, { zh: string; pos?: string }>;
  phraseZhByText: Record<string, string>;
};

type MaybeVideoMeta = {
  vocab_display_url?: string | null;
  vocab_url?: string | null;
};

function startKey(v: number) {
  return Number(v).toFixed(3);
}

function deriveVocabDisplayUrl(video: {
  vocab_display_url?: string | null;
  vocab_url?: string | null;
}): string | null {
  const direct = video.vocab_display_url?.trim();
  if (direct) return direct;
  const vu = video.vocab_url?.trim();
  if (!vu) return null;
  if (/_vocabulary_levels\.json/i.test(vu)) {
    return vu.replace(/_vocabulary_levels\.json/gi, "_vocab_display.json");
  }
  if (/_vocabulary_levels\.json\?/i.test(vu)) {
    return vu.replace(/_vocabulary_levels\.json(?=\?)/i, "_vocab_display.json");
  }
  return null;
}

function normalizePhraseKey(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^[^a-z]+/i, "")
    .replace(/[^a-z]+$/i, "")
    .replace(/\s+/g, " ");
}

function localBaseFromVideoId(videoId: string): string | null {
  if (!videoId.startsWith("local__")) return null;
  const base = videoId.slice("local__".length).trim();
  return base || null;
}

async function fetchVocabMap(videoId: string) {
  const toOut = (raw: unknown) => {
    const parsed = parseVocabDisplayFile(raw);
    const out: Record<string, { zh: string; pos?: string }> = {};
    for (const [lemma, entry] of Object.entries(parsed.entries)) {
      out[lemma] = { zh: entry.zh, pos: entry.pos };
    }
    return out;
  };
  const fromUrl = async (url: string | null) => {
    if (!url) return null;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      return toOut((await res.json()) as unknown);
    } catch {
      return null;
    }
  };

  const video = await getVideoById(videoId).catch(() => null);
  const localBase = localBaseFromVideoId(videoId);
  if (localBase) {
    try {
      const p = path.join(contentInboxDir(), `${localBase}_vocab_display.json`);
      return toOut(JSON.parse(await readFile(p, "utf8")) as unknown);
    } catch {
      // continue to URL fetch fallback
    }
  }

  const inboxMeta = await (async (): Promise<MaybeVideoMeta | null> => {
    try {
      const p = path.join(contentInboxDir(), `${videoId}.meta.json`);
      return JSON.parse(await readFile(p, "utf8")) as MaybeVideoMeta;
    } catch {
      return null;
    }
  })();

  const urlFirst =
    deriveVocabDisplayUrl((video ?? inboxMeta ?? {}) as MaybeVideoMeta) ??
    null;
  const fromRemote = await fromUrl(urlFirst);
  if (fromRemote && Object.keys(fromRemote).length > 0) return fromRemote;

  try {
    const names = await readdir(contentInboxDir());
    const candidate = names.find((n) => n.toLowerCase() === `${videoId.toLowerCase()}_vocab_display.json`);
    const suffixMatched =
      candidate ??
      names.find((n) =>
        n.toLowerCase().endsWith(`_${videoId.toLowerCase()}_vocab_display.json`),
      );
    if (suffixMatched) {
      return toOut(JSON.parse(await readFile(path.join(contentInboxDir(), suffixMatched), "utf8")) as unknown);
    }
  } catch {
    // ignore local file index errors
  }

  // Final fallback: when flashcard.video_id format does not map cleanly,
  // merge all local vocab_display files so core words can still resolve.
  try {
    const names = await readdir(contentInboxDir());
    const vocabFiles = names.filter((n) => /_vocab_display\.json$/i.test(n));
    if (vocabFiles.length > 0) {
      const merged: Record<string, { zh: string; pos?: string }> = {};
      for (const f of vocabFiles) {
        try {
          const part = toOut(
            JSON.parse(await readFile(path.join(contentInboxDir(), f), "utf8")) as unknown,
          );
          for (const [lemma, value] of Object.entries(part)) {
            if (!merged[lemma]) merged[lemma] = value;
          }
        } catch {
          // ignore broken file, continue others
        }
      }
      return merged;
    }
  } catch {
    // ignore local file scan errors
  }
  return {};
}

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId")?.trim() ?? "";
  if (!videoId) {
    return NextResponse.json({ error: "missing videoId" }, { status: 400 });
  }
  try {
    const [subs, vocabZhByLemma] = await Promise.all([
      getSubtitlesByVideoId(videoId).catch(() => []),
      fetchVocabMap(videoId).catch(() => ({})),
    ]);
    const segmentZhByStart: Record<string, string> = {};
    const phraseZhByText: Record<string, string> = {};
    for (const seg of subs) {
      if (seg.zh?.trim()) segmentZhByStart[startKey(seg.start)] = seg.zh.trim();
      for (const p of seg.phrases ?? []) {
        const gloss = normalizePhraseSidecarZhReason(p.zh, p.reason);
        const zh = gloss.zh?.trim() || gloss.reason?.trim() || "";
        if (!zh) continue;
        const textKey = normalizePhraseKey(p.text ?? "");
        if (textKey && !phraseZhByText[textKey]) phraseZhByText[textKey] = zh;
        if (seg.words && p.wStart >= 0 && p.wEnd >= p.wStart) {
          const surface = seg.words
            .slice(p.wStart, p.wEnd + 1)
            .map((w) => w.w)
            .join(" ");
          const surfaceKey = normalizePhraseKey(surface);
          if (surfaceKey && !phraseZhByText[surfaceKey]) phraseZhByText[surfaceKey] = zh;
        }
      }
    }
    const payload: ContextPayload = { videoId, segmentZhByStart, vocabZhByLemma, phraseZhByText };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

