/** Per-video sidecar: `*_vocab_display.json` (难词 lemma → 中文释义、音标等；无难度分档). */
export type VocabDisplayEntry = {
  /** @deprecated 旧工具写入的档位；前端不再用于样式或筛选 */
  level?: "cet4" | "cet6" | "ielts" | "hard";
  en_definition?: string;
  zh: string;
  ipa?: string;
  pos?: string;
};

export type VocabDisplayFile = {
  version?: number;
  entries: Record<string, VocabDisplayEntry>;
};

export type Video = {
  id: string;
  title: string;
  cover_url: string;
  video_url: string;
  subtitle_url?: string | null;
  vocab_url?: string | null;
  /** Optional COS/HTTPS URL; if absent, client may derive from vocab_url or content-inbox basename. */
  vocab_display_url?: string | null;
  /**
   * Optional sidecar `{id}_phrases.json`. If absent, server derives URL from `subtitle_url` path (same basename + `_phrases.json`).
   */
  phrases_url?: string | null;
  meta_url?: string | null;
  author: string;
  level: string;
  category: string;
  categories?: string[] | null;
  duration_sec?: number | null;
  published_at?: string | null;
  description?: string | null;
};

export type WordToken = {
  w: string;
  s: number;
  e: number;
  level?: string | null;
};

export type PhraseSpan = {
  /** Phrase surface form or template. Example: "go from A to B" */
  text: string;
  /** Why it’s useful (optional). Example: "适合出海生活场景" */
  reason?: string | null;
  /** Optional Chinese gloss (e.g. from bilingual_packager). */
  zh?: string | null;
  /** Inclusive word index range in this segment’s `words` array. */
  wStart: number;
  /** Inclusive word index range in this segment’s `words` array. */
  wEnd: number;
};

export type SubtitleSegment = {
  start: number;
  end: number;
  text: string;
  words?: WordToken[];
  phrases?: PhraseSpan[];
  zh?: string | null;
};

export type Flashcard = {
  id: string;
  user_id: string;
  word: string;
  phonetic?: string | null;
  part_of_speech?: string | null;
  meaning_zh?: string | null;
  example?: string | null;
  video_id?: string | null;
  video_title?: string | null;
  segment_start?: number | null;
  segment_end?: number | null;
  word_start?: number | null;
  word_end?: number | null;
  created_at?: string;
  /** 点词收藏为 curated；划词自定义为 custom（无列时仅本地/API 可选字段）。 */
  source?: "curated" | "custom" | null;
};

