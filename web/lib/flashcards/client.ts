/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient, safeGetBrowserUser } from "@/lib/supabase/browser";
import type { Flashcard } from "@/lib/domain/types";

const LS_KEY = "speakecho.flashcards.v1";

function readLocal(userId: string | null): Flashcard[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(LS_KEY);
  if (!raw) return [];
  try {
    const all = JSON.parse(raw) as Record<string, Flashcard[]>;
    const key = userId ?? "anonymous";
    return Array.isArray(all[key]) ? all[key] : [];
  } catch {
    return [];
  }
}

function writeLocal(userId: string | null, cards: Flashcard[]) {
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(LS_KEY);
  let all: Record<string, Flashcard[]> = {};
  try {
    all = raw ? (JSON.parse(raw) as Record<string, Flashcard[]>) : {};
  } catch {
    all = {};
  }
  const key = userId ?? "anonymous";
  all[key] = cards;
  window.localStorage.setItem(LS_KEY, JSON.stringify(all));
}

function dedupeCards(cards: Flashcard[]): Flashcard[] {
  const seen = new Set<string>();
  const out: Flashcard[] = [];
  for (const c of cards) {
    const key = [
      c.word.toLowerCase(),
      c.video_id ?? "",
      c.segment_start ?? "",
      c.word_start ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function useFlashcards() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!supabase) {
        if (cancelled) return;
        setCards(readLocal(null));
        setReady(true);
        return;
      }

      const user = await safeGetBrowserUser();
      const uid = user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);

       const localUid = readLocal(uid);
       const localAnon = uid ? readLocal(null) : [];
       const localMerged = dedupeCards([...localUid, ...localAnon]);
       if (uid && localMerged.length > 0) {
         // Migrate anonymous cards to current user bucket.
         writeLocal(uid, localMerged);
       }

      // Try DB first; if table doesn't exist, fall back to localStorage.
      let res;
      try {
        res = await supabase.from("flashcards").select("*").order("created_at", { ascending: false });
      } catch {
        setCards(localMerged);
        setReady(true);
        return;
      }
      if (res.error) {
        setCards(localMerged);
        setReady(true);
        return;
      }

      const dbCards = (res.data ?? []) as Flashcard[];
      // Keep local cards even when DB returns empty/non-authoritative results.
      setCards(dedupeCards([...dbCards, ...localMerged]));
      setReady(true);
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const add = useCallback(
    async (draft: Omit<Flashcard, "id" | "user_id" | "created_at">) => {
      const now = new Date().toISOString();
      const temp: Flashcard = {
        id: crypto.randomUUID(),
        user_id: userId ?? "anonymous",
        created_at: now,
        ...draft,
      };

      setCards((prev) => {
        const next = dedupeCards([temp, ...prev]);
        writeLocal(userId, next);
        return next;
      });

      if (supabase && userId) {
        let error: { message?: string } | null = null;
        try {
          const res = await supabase.from("flashcards").insert({
            ...temp,
            user_id: userId,
          } as any);
          error = res.error as { message?: string } | null;
        } catch {
          error = { message: "network_error" };
        }

        if (error) {
          // keep local fallback
          return;
        }
      }
    },
    [supabase, userId],
  );

  const remove = useCallback(
    async (id: string) => {
      setCards((prev) => {
        const next = prev.filter((c) => c.id !== id);
        writeLocal(userId, next);
        return next;
      });

      if (supabase && userId) {
        try {
          await supabase.from("flashcards").delete().eq("id", id);
        } catch {
          // keep local delete only
        }
      }
    },
    [supabase, userId],
  );

  const byWord = useCallback(
    (word: string) => cards.find((c) => c.word.toLowerCase() === word.toLowerCase()) ?? null,
    [cards],
  );

  return { ready, cards, add, remove, byWord };
}

