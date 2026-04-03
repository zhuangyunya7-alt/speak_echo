import COS from "cos-nodejs-sdk-v5";

import type { Video } from "@/lib/domain/types";

/** Matches virtual-hosted–style public endpoint: `{bucket}.cos.{region}.myqcloud.com` */
const HOST_RE = /^([^.]+)\.cos\.([^.]+)\.myqcloud\.com$/;

export type CosObjectLocator = {
  bucket: string;
  region: string;
  key: string;
};

export function parseTencentCosPublicUrl(urlStr: string): CosObjectLocator | null {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return null;
    const m = u.hostname.match(HOST_RE);
    if (!m) return null;
    const bucket = m[1];
    const region = m[2];
    const key = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!key) return null;
    const allow = process.env.COS_SIGN_ALLOWED_BUCKETS?.trim();
    if (allow) {
      const ok = new Set(
        allow
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      if (!ok.has(bucket)) return null;
    }
    return { bucket, region, key };
  } catch {
    return null;
  }
}

function cosSigningEnabled(): boolean {
  if (process.env.COS_SIGN_MEDIA === "0") return false;
  return !!(process.env.COS_SECRET_ID?.trim() && process.env.COS_SECRET_KEY?.trim());
}

let cosClient: COS | null | undefined;

function getCosClient(): COS | null {
  if (cosClient !== undefined) return cosClient;
  const SecretId = process.env.COS_SECRET_ID?.trim();
  const SecretKey = process.env.COS_SECRET_KEY?.trim();
  if (!SecretId || !SecretKey) {
    cosClient = null;
    return null;
  }
  cosClient = new COS({ SecretId, SecretKey });
  return cosClient;
}

function signExpiresSec(): number {
  const n = Number(process.env.COS_SIGN_EXPIRES_SEC ?? 7200);
  const v = Number.isFinite(n) ? n : 7200;
  return Math.min(Math.max(Math.floor(v), 60), 86400);
}

/**
 * For COS objects: return a short-lived signed URL when server credentials are set
 * (`COS_SECRET_ID` / `COS_SECRET_KEY`). Otherwise return the original string.
 * Bucket should be **private read** so unsigned COS URLs no longer work.
 */
export async function resolvePlayableMediaUrl(url: string | null | undefined): Promise<string | null> {
  if (url == null || url === "") return null;
  const loc = parseTencentCosPublicUrl(url);
  if (!loc) return url;
  if (!cosSigningEnabled()) return url;
  const cos = getCosClient();
  if (!cos) return url;
  const expires = signExpiresSec();
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      {
        Bucket: loc.bucket,
        Region: loc.region,
        Key: loc.key,
        Sign: true,
        Expires: expires,
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data?.Url ?? url);
      },
    );
  });
}

async function safeResolve(url: string | undefined | null, fallback: string): Promise<string> {
  if (!url) return fallback;
  try {
    return (await resolvePlayableMediaUrl(url)) ?? fallback;
  } catch {
    return fallback;
  }
}

async function safeResolveNullable(url: string | undefined | null): Promise<string | null> {
  if (url == null || url === "") return null;
  try {
    return await resolvePlayableMediaUrl(url);
  } catch {
    return url;
  }
}

/** Replace Tencent COS links on a video with signed URLs for browser use. */
export async function signVideoMediaForClient(video: Video): Promise<Video> {
  if (!cosSigningEnabled()) return video;
  const [video_url, subtitle_url, vocab_url, vocab_display_url, phrases_url, cover_url] = await Promise.all([
    safeResolve(video.video_url, video.video_url),
    safeResolveNullable(video.subtitle_url ?? null),
    safeResolveNullable(video.vocab_url ?? null),
    safeResolveNullable(video.vocab_display_url ?? null),
    safeResolveNullable(video.phrases_url ?? null),
    safeResolve(video.cover_url, video.cover_url),
  ]);
  return {
    ...video,
    video_url,
    subtitle_url,
    vocab_url,
    vocab_display_url,
    phrases_url,
    cover_url,
  };
}
