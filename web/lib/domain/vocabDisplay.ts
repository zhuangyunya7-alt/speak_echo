import type { VocabDisplayEntry, VocabDisplayFile } from "@/lib/domain/types";

/** Same rules as subtitle / vocab card dedupe (lemma key). */
export function normalizeVocabLemma(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^a-z]+/i, "")
    .replace(/[^a-z]+$/i, "");
}

export function parseVocabDisplayFile(raw: unknown): VocabDisplayFile {
  if (!raw || typeof raw !== "object") return { entries: {} };
  const o = raw as Record<string, unknown>;
  const rawEntries = o.entries;
  const entries: Record<string, VocabDisplayEntry> = {};
  if (rawEntries && typeof rawEntries === "object") {
    for (const [k, v] of Object.entries(rawEntries as Record<string, unknown>)) {
      const lemma = normalizeVocabLemma(k);
      if (!lemma) continue;
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      const lv = e.level;
      const level =
        lv === "cet4" || lv === "cet6" || lv === "ielts" || lv === "hard" ? lv : undefined;
      const zh = typeof e.zh === "string" ? e.zh : "";
      const en = typeof e.en_definition === "string" ? e.en_definition : "";
      const ipa = typeof e.ipa === "string" ? e.ipa.trim() : "";
      if (!zh.trim() && !en.trim() && !ipa) continue;
      entries[lemma] = {
        ...(level ? { level } : {}),
        ...(en.trim() ? { en_definition: en.trim() } : {}),
        zh: zh.trim(),
        ...(ipa ? { ipa } : {}),
        pos: typeof e.pos === "string" ? e.pos : undefined,
      };
    }
  }
  return { version: typeof o.version === "number" ? o.version : 1, entries };
}
