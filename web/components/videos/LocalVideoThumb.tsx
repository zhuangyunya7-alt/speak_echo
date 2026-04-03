"use client";

import { useEffect, useMemo, useState } from "react";

function cacheKey(url: string) {
  return `speakecho.thumb.v1:${url}`;
}

function readCache(url: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(cacheKey(url));
  } catch {
    return null;
  }
}

function writeCache(url: string, dataUrl: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(cacheKey(url), dataUrl);
  } catch {
    // ignore quota errors
  }
}

export function LocalVideoThumb({
  videoUrl,
  alt,
  fallbackCoverUrl,
}: {
  videoUrl: string;
  alt: string;
  fallbackCoverUrl?: string | null;
}) {
  const cover = useMemo(() => (fallbackCoverUrl?.trim() ?? ""), [fallbackCoverUrl]);
  const [coverFailed, setCoverFailed] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const preferCover = cover.length > 0 && !coverFailed;

  const cached = useMemo(() => readCache(videoUrl), [videoUrl]);
  useEffect(() => {
    if (cached) setDataUrl(cached);
  }, [cached]);

  useEffect(() => {
    const skipVideo = cover.length > 0 && !coverFailed;
    if (skipVideo || dataUrl || failed) return;

    let cancelled = false;

    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    v.src = videoUrl;

    const cleanup = () => {
      v.removeAttribute("src");
      v.load();
    };

    const onLoaded = () => {
      try {
        const w = v.videoWidth || 640;
        const h = v.videoHeight || 360;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no ctx");
        ctx.drawImage(v, 0, 0, w, h);
        const url = canvas.toDataURL("image/jpeg", 0.82);
        if (cancelled) return;
        setDataUrl(url);
        writeCache(videoUrl, url);
      } catch {
        if (cancelled) return;
        setFailed(true);
      } finally {
        cleanup();
      }
    };

    const onError = () => {
      if (cancelled) return;
      setFailed(true);
      cleanup();
    };

    v.addEventListener("loadeddata", onLoaded, { once: true });
    v.addEventListener("error", onError, { once: true });
    v.load();

    return () => {
      cancelled = true;
      v.removeEventListener("loadeddata", onLoaded);
      v.removeEventListener("error", onError);
      cleanup();
    };
  }, [cover, coverFailed, videoUrl, dataUrl, failed]);

  if (preferCover) {
    return (
      <img
        src={cover}
        alt={alt}
        className="h-full w-full object-cover"
        onError={() => setCoverFailed(true)}
      />
    );
  }

  if (dataUrl) {
    return <img src={dataUrl} alt={alt} className="h-full w-full object-cover" />;
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {failed ? "Preview unavailable" : "Generating preview…"}
    </div>
  );
}
