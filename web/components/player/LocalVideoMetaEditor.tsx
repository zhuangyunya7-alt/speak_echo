"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TOPIC_TAXONOMY, type TopicL1, topicCombo } from "@/lib/domain/taxonomy";

const L1_OPTIONS = Object.keys(TOPIC_TAXONOMY) as TopicL1[];

const LEVELS = ["★☆☆☆☆", "★★☆☆☆", "★★★☆☆", "★★★★☆", "★★★★★"] as const;

export function LocalVideoMetaEditor({
  base,
  initial,
}: {
  base: string;
  initial: { title: string; level: string; categories: string[]; author: string; description: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial.title);
  const [level, setLevel] = useState(initial.level);
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [author, setAuthor] = useState(initial.author);
  const [description, setDescription] = useState(initial.description);

  const selectedL1 = useMemo(() => {
    const hit = categories
      .map((c) => c.split("-")[0]?.trim())
      .find((c1) => !!c1 && L1_OPTIONS.includes(c1 as TopicL1));
    return hit ?? "";
  }, [categories]);

  const l2Options = useMemo(() => {
    if (!selectedL1) return [];
    return (TOPIC_TAXONOMY[selectedL1 as TopicL1] ?? []).map((t) => ({ value: t, label: t }));
  }, [selectedL1]);

  const dirty = useMemo(() => {
    return (
      title !== initial.title ||
      level !== initial.level ||
      categories.join("|") !== initial.categories.join("|") ||
      author !== initial.author ||
      description !== initial.description
    );
  }, [author, categories, description, initial, level, title]);

  function extractErrorMessage(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null) return null;
    if (!("error" in payload)) return null;
    const v = (payload as Record<string, unknown>).error;
    return typeof v === "string" ? v : null;
  }

  async function save() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/local-video-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base, title, level, categories, author, description, category: categories[0] ?? "" }),
      });
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(extractErrorMessage(j) || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(true)}>
        编辑信息
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/30" type="button" aria-label="关闭" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-1/2 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">编辑视频信息</div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">将写入 `content-inbox/{base}.meta.json`</div>
              </div>
              <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(false)}>
                关闭
              </Button>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            ) : null}

            <div className="mt-4 grid gap-4">
              <Input label="视频标题" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="请输入标题" />

              <label className="block">
                <div className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">难度</div>
                <select
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  <option value="">—</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">话题分类（一级/二级）</div>
                <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="grid gap-3">
                    <label className="block">
                      <div className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">一级标签</div>
                      <select
                        className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                        value={selectedL1}
                        onChange={(e) => {
                          const nextL1 = e.target.value;
                          if (!nextL1) {
                            setCategories([]);
                            return;
                          }
                          // switching L1 clears all combos
                          setCategories([]);
                        }}
                      >
                        <option value="">—</option>
                        {L1_OPTIONS.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div>
                      <div className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">二级标签（可多选）</div>
                      <div className="grid grid-cols-2 gap-2">
                        {l2Options.length === 0 ? (
                          <div className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">先选择一级标签</div>
                        ) : (
                          l2Options.map((o) => {
                            const combo = selectedL1 ? topicCombo(selectedL1, o.value) : "";
                            const checked = combo ? categories.includes(combo) : false;
                            return (
                              <label key={o.value} className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    if (!selectedL1) return;
                                    const c = topicCombo(selectedL1, o.value);
                                    setCategories((prev) => {
                                      if (e.target.checked) return Array.from(new Set([...prev, c]));
                                      return prev.filter((x) => x !== c);
                                    });
                                  }}
                                />
                                <span>{o.label}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    保存后会写入 `categories: [&quot;一级-二级&quot;...]`，主页筛选会匹配任意一个标签。
                  </div>
                </div>
              </label>

              <Input label="博主/来源" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="例如：某某访谈" />

              <label className="block">
                <div className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">简介</div>
                <textarea
                  className="min-h-24 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="可选"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="button" onClick={save} disabled={loading || !dirty}>
                {loading ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

