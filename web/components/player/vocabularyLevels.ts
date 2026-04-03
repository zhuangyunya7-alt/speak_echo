"use client";

import { useEffect, useMemo, useState } from "react";

/** Normalized lemmas from `*_vocabulary_levels.json`（难词，不分档）. */
export type VocabularyLevels = {
  hard: Set<string>;
};

function normalize(word: string) {
  return word
    .toLowerCase()
    .replace(/^[^a-z]+/i, "")
    .replace(/[^a-z]+$/i, "");
}

function emptyLevels(): VocabularyLevels {
  return { hard: new Set() };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function mergeLegacyTierBuckets(raw: Record<string, unknown>, into: Set<string>) {
  const keys = ["cet4", "cet6", "ielts", "CET4", "CET6", "IELTS"];
  for (const key of keys) {
    const arr = asStringArray(raw[key]);
    for (const w of arr) {
      const n = normalize(w);
      if (n) into.add(n);
    }
  }
}

/** Parse unified hard-word list or legacy { cet4, cet6, ielts } (merged into one set). */
export function parseVocabularyLevelsJson(raw: unknown): VocabularyLevels {
  if (Array.isArray(raw)) {
    const hard = new Set<string>();
    for (const w of asStringArray(raw)) {
      const n = normalize(w);
      if (n) hard.add(n);
    }
    return { hard };
  }
  if (!raw || typeof raw !== "object") return emptyLevels();

  const o = raw as Record<string, unknown>;
  const hard = new Set<string>();
  const addAll = (arr: string[]) => {
    for (const w of arr) {
      const n = normalize(w);
      if (n) hard.add(n);
    }
  };

  for (const key of ["words", "hard", "hard_words", "vocab", "difficult_words", "难词"]) {
    addAll(asStringArray(o[key]));
  }

  mergeLegacyTierBuckets(o, hard);

  return { hard };
}

export function useVocabularyLevels(
  assetBase: string | null,
  enabled: boolean,
  fallbackBase?: string | null,
) {
  const [levels, setLevels] = useState<VocabularyLevels>(() => emptyLevels());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!assetBase && !fallbackBase) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      const tryFetch = async (url: string) => {
        const res = await fetch(url, {
          cache:
            url.startsWith("/api/proxy") || url.startsWith("/api/content-inbox")
              ? "no-store"
              : "force-cache",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as unknown;
        return parseVocabularyLevelsJson(raw);
      };

      const urlsToTry: string[] = [];
      if (assetBase) {
        if (assetBase.startsWith("http")) {
          urlsToTry.push(`/api/proxy-vocab?url=${encodeURIComponent(assetBase)}`);
        } else {
          urlsToTry.push(
            `/api/content-inbox/${encodeURIComponent(`${assetBase}_vocabulary_levels.json`)}`,
          );
          urlsToTry.push(`/data/${encodeURIComponent(assetBase)}_vocabulary_levels.json`);
        }
      }
      if (fallbackBase && assetBase?.startsWith("http")) {
        urlsToTry.push(
          `/api/content-inbox/${encodeURIComponent(`${fallbackBase}_vocabulary_levels.json`)}`,
        );
        urlsToTry.push(`/data/${encodeURIComponent(fallbackBase)}_vocabulary_levels.json`);
      }

      for (const url of urlsToTry) {
        try {
          const next = await tryFetch(url);
          if (cancelled) return;
          setLevels(next);
          break;
        } catch (e) {
          if (cancelled) return;
          if (url === urlsToTry[urlsToTry.length - 1]) {
            setLevels(emptyLevels());
            setError(e instanceof Error ? e.message : "加载失败");
          }
        }
      }

      if (cancelled) return;
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [assetBase, enabled, fallbackBase]);

  const classifyWord = useMemo(() => {
    return (rawWord: string): boolean => {
      const w = normalize(rawWord);
      if (!w) return false;
      return levels.hard.has(w);
    };
  }, [levels]);

  return { levels, classifyWord, loading, error };
}
