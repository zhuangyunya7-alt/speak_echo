"use client";

import { useEffect, useMemo, useState } from "react";
import { readRecord, type RecordState } from "@/lib/record/client";
import { useFlashcards } from "@/lib/flashcards/client";
import { loadLearningFromSupabase } from "@/lib/learning/sync";

function fmt(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h <= 0) return `${m} 分钟`;
  return `${h} 小时 ${m} 分钟`;
}

function lastNDays(n: number) {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function RecordClient() {
  const { ready, cards } = useFlashcards();
  const [record, setRecord] = useState<RecordState>(() => readRecord());

  useEffect(() => {
    loadLearningFromSupabase()
      .then((r) => {
        if (!r) return;
        setRecord({ totalSeconds: r.totalSeconds, byDaySeconds: r.byDaySeconds });
      })
      .catch(() => {});
  }, []);

  const days = useMemo(() => lastNDays(7), []);
  const max = Math.max(1, ...days.map((d) => record.byDaySeconds[d] ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">学习记录</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          统计你的学习时长、近7天学习趋势与词汇收藏。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">累计学习时长</div>
          <div className="mt-2 text-2xl font-semibold">{fmt(record.totalSeconds)}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">已收藏生词</div>
          <div className="mt-2 text-2xl font-semibold">{ready ? cards.length : "—"}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">近 7 天</div>
          <div className="mt-3 flex items-end gap-2">
            {days.map((d) => {
              const v = record.byDaySeconds[d] ?? 0;
              const h = Math.max(6, Math.round((v / max) * 56));
              return (
                <div key={d} className="flex flex-col items-center gap-1">
                  <div
                    className="w-6 rounded-md bg-[#602D89]"
                    style={{ height: h }}
                    title={`${d}: ${fmt(v)}`}
                  />
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{d.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        后续规划：学习日历热力图、词汇增长曲线、按视频统计学习历史。
      </div>
    </div>
  );
}

