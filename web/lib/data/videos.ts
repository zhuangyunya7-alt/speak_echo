import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mockVideos } from "@/lib/data/mock";
import type { Video } from "@/lib/domain/types";
import { listLocalVideos, getLocalVideoById } from "@/lib/data/localAssets";
import { signVideoMediaForClient } from "@/lib/media/tencentCos";

export type VideoFilters = {
  l1?: string;
  l2?: string;
  level?: string;
  creator?: string;
  duration?: "short" | "mid" | "long";
};

function durationBucket(durationSec?: number | null): VideoFilters["duration"] | undefined {
  if (!durationSec && durationSec !== 0) return undefined;
  if (durationSec < 5 * 60) return "short";
  if (durationSec <= 10 * 60) return "mid";
  return "long";
}

function normalizeCats(video: Video): string[] {
  const cats = Array.isArray(video.categories) ? video.categories : [];
  if (cats.length > 0) return cats;
  return video.category ? [video.category] : [];
}

/**
 * Public catalog + video page: treat missing/empty `published_at` as already visible;
 * otherwise only after timestamp has passed (scheduled / 思路 A).
 */
function isVideoVisibleOnSite(publishedAt: string | null | undefined): boolean {
  if (publishedAt == null || publishedAt.trim() === "") return true;
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return true;
  return t <= Date.now();
}

function applyFilters(items: Video[], filters: VideoFilters): Video[] {
  return items.filter((v) => {
    if (filters.l1 || filters.l2) {
      const cats = normalizeCats(v);
      const wantL2 = filters.l2 ? filters.l2.toLowerCase() : "";
      const matched = cats.some((c) => {
        const idx = c.indexOf("-");
        const c1 = idx > 0 ? c.slice(0, idx) : c;
        const c2 = idx > 0 ? c.slice(idx + 1) : "";
        if (filters.l1 && c1 !== filters.l1) return false;
        if (filters.l2 && c2.toLowerCase() !== wantL2) return false;
        return true;
      });
      if (!matched) return false;
    }
    if (filters.creator && v.author !== filters.creator) return false;
    if (filters.level && v.level !== filters.level) return false;
    if (filters.duration && durationBucket(v.duration_sec) !== filters.duration) return false;
    return true;
  });
}

function stripUrlQuery(url?: string | null): string | null {
  if (!url) return null;
  return url.split("?")[0];
}

function videoIdentityKey(v: Video): string {
  // For local/dev we might load the same underlying video twice:
  // - once from `content-inbox` (id: local__)
  // - once from Supabase (remote id)
  // Use COS URLs as identity when possible.
  const subtitle = stripUrlQuery(v.subtitle_url ?? null);
  if (subtitle) return `subtitle:${subtitle}`;
  const vocab = stripUrlQuery(v.vocab_url ?? null);
  if (vocab) return `vocab:${vocab}`;
  const videoUrl = stripUrlQuery(v.video_url ?? null);
  if (videoUrl) return `video:${videoUrl}`;
  if (v.id.startsWith("local__")) {
    // If meta URLs are missing locally, fall back to `id` base match.
    return `id:${v.id.slice("local__".length)}`;
  }
  return `id:${v.id}`;
}

function dedupeByIdentity(items: Video[]): Video[] {
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const v of items) {
    const key = videoIdentityKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export async function listVideos(filters: VideoFilters): Promise<Video[]> {
  const includeLocal = process.env.NODE_ENV !== "production";
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const local = await listLocalVideos();
    const all = [...local, ...mockVideos].filter((v) => isVideoVisibleOnSite(v.published_at));
    const filtered = applyFilters(all, filters);
    return Promise.all(filtered.map((v) => signVideoMediaForClient(v)));
  }

  const local = includeLocal ? await listLocalVideos() : [];

  const nowIso = new Date().toISOString();
  let query = supabase
    .from("videos")
    .select("*")
    .or(`published_at.is.null,published_at.lte."${nowIso}"`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });

  if (filters.creator) query = query.eq("author", filters.creator);
  if (filters.level) query = query.eq("level", filters.level);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const merged = [...local, ...((data ?? []) as Video[])].filter((v) =>
    isVideoVisibleOnSite(v.published_at),
  );
  merged.sort((a, b) => {
    const aTime = a.published_at ?? "";
    const bTime = b.published_at ?? "";
    if (aTime === bTime) {
      const aLocal = a.id.startsWith("local__");
      const bLocal = b.id.startsWith("local__");
      if (aLocal !== bLocal) return aLocal ? 1 : -1;
      return 0;
    }
    return aTime < bTime ? 1 : -1;
  });
  const deduped = dedupeByIdentity(merged);
  // Supabase query already applied topic/creator/level for DB items, but local items still need filtering.
  // For simplicity and correctness, apply filters again to the merged list.
  const filtered = applyFilters(deduped, filters);
  return Promise.all(filtered.map((v) => signVideoMediaForClient(v)));
}

export async function getVideoById(id: string): Promise<Video | null> {
  if (id.startsWith("local__")) {
    const v = await getLocalVideoById(id);
    if (!v || !isVideoVisibleOnSite(v.published_at)) return null;
    return signVideoMediaForClient(v);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const m = mockVideos.find((v) => v.id === id) ?? null;
    if (!m || !isVideoVisibleOnSite(m.published_at)) return null;
    return signVideoMediaForClient(m);
  }

  const { data, error } = await supabase.from("videos").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data as Video | null) ?? null;
  if (!row || !isVideoVisibleOnSite(row.published_at)) return null;
  return signVideoMediaForClient(row);
}

