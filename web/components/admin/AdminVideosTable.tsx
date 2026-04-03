"use client";

import { useMemo, useState } from "react";
import type { Video } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TOPIC_TAXONOMY, type TopicL1, topicCombo } from "@/lib/domain/taxonomy";

const L1_OPTIONS = Object.keys(TOPIC_TAXONOMY) as TopicL1[];

const LEVELS = ["★☆☆☆☆", "★★☆☆☆", "★★★☆☆", "★★★★☆", "★★★★★"] as const;

type Row = {
  base: string;
  videoUrl: string;
  title: string;
  level: string;
  l1: string;
  l2s: string[];
  categories: string[];
  description: string;
  author: string;
};

function baseFromLocalId(id: string) {
  return id.startsWith("local__") ? id.slice("local__".length) : id;
}

export function AdminVideosTable({ videos }: { videos: Video[] }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>(
    videos.map((v) => ({
      base: baseFromLocalId(v.id),
      videoUrl: v.video_url,
      title: v.title,
      level: v.level ?? "",
      l1:
        (Array.isArray(v.categories) && v.categories[0] ? v.categories[0].split("-")[0]?.trim() : v.category ?? "") ||
        "",
      l2s: Array.isArray(v.categories)
        ? v.categories
            .map((c) => c.split("-")[1]?.trim())
            .filter((x): x is string => !!x)
        : [],
      categories:
        Array.isArray(v.categories) && v.categories.length > 0 ? v.categories : [v.category ?? ""].filter(Boolean),
      description: v.description ?? "",
      author: v.author ?? "",
    })),
  );

  const dirtyCount = useMemo(() => rows.length, [rows.length]);

  function extractErrorMessage(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null) return null;
    if (!("error" in payload)) return null;
    const v = (payload as Record<string, unknown>).error;
    return typeof v === "string" ? v : null;
  }

  async function saveRow(row: Row) {
    setError(null);
    setSaving(row.base);
    try {
      const res = await fetch("/api/local-video-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base: row.base,
          title: row.title,
          level: row.level,
          categories: row.categories,
          category: row.categories[0]?.split("-")[0] ?? "",
          author: row.author,
          description: row.description,
        }),
      });
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(extractErrorMessage(j) || `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">视频管理（管理员）</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          集中编辑本地视频的标题/难度/话题/简介。保存后会写入仓库根目录 `content-inbox/&lt;base&gt;.meta.json`。
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900/30 dark:text-zinc-300">
            <tr>
              <th className="px-3 py-2 text-left">文件</th>
              <th className="px-3 py-2 text-left">视频链接</th>
              <th className="px-3 py-2 text-left">标题</th>
              <th className="px-3 py-2 text-left">难度</th>
              <th className="px-3 py-2 text-left">一级标签</th>
              <th className="px-3 py-2 text-left">二级标签（多选）</th>
              <th className="px-3 py-2 text-left">简介</th>
              <th className="px-3 py-2 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.base} className="border-t border-zinc-200 dark:border-zinc-800 align-top">
                <td className="px-3 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">{r.base}</td>
                <td className="px-3 py-3 text-xs text-zinc-600 dark:text-zinc-300">{r.videoUrl}</td>
                <td className="px-3 py-3">
                  <Input
                    label=""
                    value={r.title}
                    onChange={(e) =>
                      setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))
                    }
                  />
                </td>
                <td className="px-3 py-3">
                  <select
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                    value={r.level}
                    onChange={(e) =>
                      setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, level: e.target.value } : x)))
                    }
                  >
                    <option value="">—</option>
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-3">
                  <select
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                    value={r.l1}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, l1: e.target.value, l2s: [], categories: [] }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="">—</option>
                    {L1_OPTIONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-3">
                  <div className="grid grid-cols-2 gap-2">
                    {(TOPIC_TAXONOMY[(r.l1 as TopicL1) || "出海职场"] ?? []).map((t) => {
                      const enabled = !!r.l1;
                      const checked = r.l2s.includes(t);
                      return (
                        <label
                          key={t}
                          className={`flex items-center gap-2 text-xs ${
                            enabled ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-600"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!enabled}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((x, i) => {
                                  if (i !== idx) return x;
                                  if (!x.l1) return x;
                                  const nextL2s = e.target.checked
                                    ? Array.from(new Set([...x.l2s, t]))
                                    : x.l2s.filter((c) => c !== t);
                                  const nextCats = nextL2s.map((l2) => topicCombo(x.l1, l2));
                                  return { ...x, l2s: nextL2s, categories: nextCats };
                                }),
                              )
                            }
                          />
                          <span>{t}</span>
                        </label>
                      );
                    })}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <textarea
                    className="min-h-24 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                    value={r.description}
                    onChange={(e) =>
                      setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                    }
                  />
                </td>
                <td className="px-3 py-3">
                  <Button type="button" onClick={() => saveRow(r)} disabled={saving !== null}>
                    {saving === r.base ? "保存中…" : "保存"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-zinc-500 dark:text-zinc-400">共 {dirtyCount} 条本地视频。</div>
    </div>
  );
}

