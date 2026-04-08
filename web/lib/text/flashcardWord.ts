/** Strip outer punctuation for flashcard display/storage (keeps internal apostrophe in don't). */
export function normalizeFlashcardWordSurface(raw: string): string {
  return raw
    .trim()
    .replace(/^[\s"'“”‘’[\]()]+/u, "")
    .replace(/[\s,.;:!?。，、；：'")'"'"'"'")\]]+$/u, "");
}
