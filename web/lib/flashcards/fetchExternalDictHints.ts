/** Best-effort IPA/PoS from dictionaryapi.dev (same family as WordLookupPopover). */

type DictApiEntry = {
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Array<{ partOfSpeech?: string }>;
};

export async function fetchExternalDictHints(englishHeadword: string): Promise<{
  phonetic: string | null;
  part_of_speech: string | null;
} | null> {
  const w = englishHeadword.trim().split(/\s+/)[0] ?? "";
  if (!w) return null;
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const arr = Array.isArray(json) ? (json as DictApiEntry[]) : [];
    const first = arr[0];
    if (!first) return null;
    const phonetic =
      first.phonetic?.trim() ||
      first.phonetics?.map((p) => p.text?.trim()).find((t) => Boolean(t)) ||
      null;
    const part = first.meanings?.[0]?.partOfSpeech?.trim() || null;
    return { phonetic, part_of_speech: part };
  } catch {
    return null;
  }
}
