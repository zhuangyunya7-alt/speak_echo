"use client";

import { useEffect, useMemo, useState } from "react";

import type { Video, VocabDisplayEntry } from "@/lib/domain/types";
import { parseVocabDisplayFile } from "@/lib/domain/vocabDisplay";

export function resolveVocabDisplayFetchUrl(
  video: Video,
  assetBase: string | null,
  fallbackBase: string | null,
): string | null {
  const directVocabDisplayUrl = video.vocab_display_url?.trim();
  if (directVocabDisplayUrl) {
    if (directVocabDisplayUrl.startsWith("http")) {
      return `/api/proxy-vocab?url=${encodeURIComponent(directVocabDisplayUrl)}`;
    }
    return directVocabDisplayUrl;
  }

  for (const b of [assetBase, fallbackBase]) {
    if (!b || b.startsWith("http")) continue;
    return `/api/content-inbox/${encodeURIComponent(b)}_vocab_display.json`;
  }

  const vu = video.vocab_url?.trim();
  if (vu && /_vocabulary_levels\.json/i.test(vu)) {
    const derived = vu.replace(/_vocabulary_levels\.json/gi, "_vocab_display.json");
    if (derived.startsWith("http")) return `/api/proxy-vocab?url=${encodeURIComponent(derived)}`;
    return derived;
  }
  if (vu && /_vocabulary_levels\.json\?/i.test(vu)) {
    const derived = vu.replace(/_vocabulary_levels\.json(?=\?)/i, "_vocab_display.json");
    if (derived.startsWith("http")) return `/api/proxy-vocab?url=${encodeURIComponent(derived)}`;
    return derived;
  }

  return null;
}

export function useVocabDisplay(fetchUrl: string | null) {
  const [entries, setEntries] = useState<Record<string, VocabDisplayEntry>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fetchUrl) {
      setEntries({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(fetchUrl, {
          cache: fetchUrl.startsWith("/api/") ? "no-store" : "default",
        });
        if (!res.ok) throw new Error(String(res.status));
        const raw = (await res.json()) as unknown;
        const parsed = parseVocabDisplayFile(raw);
        if (!cancelled) setEntries(parsed.entries);
      } catch {
        if (!cancelled) setEntries({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchUrl]);

  const hasAny = useMemo(() => Object.keys(entries).length > 0, [entries]);

  return { entries, loading, hasAny };
}
