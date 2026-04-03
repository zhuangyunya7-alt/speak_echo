import rawTaxonomy from "./taxonomy.json";

/** 唯一数据源：`taxonomy.json`（上传助手默认读取 `web/lib/domain/taxonomy.json`）。 */
export type TopicL1 = keyof typeof rawTaxonomy;

export type TopicTaxonomy = Readonly<Record<TopicL1, readonly string[]>>;

export const TOPIC_TAXONOMY: TopicTaxonomy = rawTaxonomy as TopicTaxonomy;

export function topicCombo(l1: string, l2: string) {
  const a = l1.trim();
  const b = l2.trim();
  if (!a) return "";
  if (!b) return a;
  return `${a}-${b}`;
}

export function parseTopicCombo(combo: string): { l1: string; l2: string } | null {
  const idx = combo.indexOf("-");
  if (idx <= 0) return null;
  const l1 = combo.slice(0, idx).trim();
  const l2 = combo.slice(idx + 1).trim();
  if (!l1 || !l2) return null;
  return { l1, l2 };
}
