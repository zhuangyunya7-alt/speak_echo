"use client";

import { useEffect, useMemo, useState } from "react";
import { readRecord } from "@/lib/record/client";
import { readLearnedDates, todayKey } from "@/lib/learning/learnedDates";
import { useFlashcards } from "@/lib/flashcards/client";
import { loadLearningFromSupabase } from "@/lib/learning/sync";

function fmt(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h <= 0) return `${m} 分钟`;
  return `${h} 小时 ${m} 分钟`;
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function monthMatrix(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  const startWeekday = (first.getDay() + 6) % 7; // Monday=0
  const daysInMonth = last.getDate();
  const cells: Array<{ day: number | null; key: string | null }> = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ day: null, key: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const k = new Date(year, monthIndex, d).toISOString().slice(0, 10);
    cells.push({ day: d, key: k });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, key: null });
  return cells;
}

export function LearningSidebar() {
  const { ready: flashReady, cards } = useFlashcards();
  const [learned, setLearned] = useState<string[]>(() => readLearnedDates());
  const [totalSeconds, setTotalSeconds] = useState(() => readRecord().totalSeconds);

  useEffect(() => {
    // If logged in and Supabase available, load cross-device data.
    loadLearningFromSupabase()
      .then((r) => {
        if (!r) return;
        setLearned(r.learned);
        setTotalSeconds(r.totalSeconds);
      })
      .catch(() => {});

    const onStorage = () => {
      setLearned(readLearnedDates());
      setTotalSeconds(readRecord().totalSeconds);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const learnedSet = useMemo(() => new Set(learned), [learned]);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const cells = monthMatrix(y, m);
  const tKey = todayKey(now);
  const CHALLENGE_DAYS = 21;

  const challengeDates: string[] = [];
  for (let i = 0; i < CHALLENGE_DAYS; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    challengeDates.push(todayKey(d));
  }

  const challengeCompleted = challengeDates.filter((d) => learnedSet.has(d)).length;
  let challengeStreak = 0;
  for (const d of challengeDates) {
    if (learnedSet.has(d)) challengeStreak += 1;
    else break;
  }
  const todayLearned = learnedSet.has(tKey);

  return (
    <aside className="space-y-4 lg:sticky lg:top-[84px]">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-sm font-semibold">学习统计</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/30">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">累计学习时长</div>
            <div className="mt-1 text-lg font-semibold">{fmt(totalSeconds)}</div>
          </div>
          <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/30">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">已学习天数</div>
            <div className="mt-1 text-lg font-semibold">{learned.length}</div>
          </div>
          <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/30">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">已收藏生词</div>
            <div className="mt-1 text-lg font-semibold">{flashReady ? cards.length : "—"}</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
        <div className="flex items-center justify-between">
          <div className="font-semibold">21 天学习挑战</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {challengeCompleted} / {CHALLENGE_DAYS} 天
          </div>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-900/40">
          <div
            className="h-2 rounded-full bg-[#602D89] transition-[width]"
            style={{
              width: `${Math.min(
                100,
                CHALLENGE_DAYS ? (challengeCompleted / CHALLENGE_DAYS) * 100 : 0,
              ).toFixed(1)}%`,
            }}
          />
        </div>
        <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          连续打卡：{challengeStreak} 天 · 今日：{todayLearned ? "已完成" : "未完成"}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">学习日历</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {now.toLocaleString("zh-CN", { year: "numeric", month: "long" })}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
          {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2">
          {cells.map((c, i) => {
            const isLearned = c.key ? learnedSet.has(c.key) : false;
            const isToday = c.key === tKey;
            return (
              <div
                key={`${c.key ?? "x"}-${i}`}
                className={[
                  "relative flex h-9 items-center justify-center rounded-xl border text-sm",
                  c.day == null
                    ? "border-transparent"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
                  isToday ? "ring-2 ring-[#602D89]/40" : "",
                ].join(" ")}
              >
                {isLearned ? (
                  <CheckIcon className="absolute top-1 h-4 w-4 text-[#602D89]" />
                ) : null}
                <div className={c.day == null ? "text-transparent" : "text-zinc-900 dark:text-zinc-100"}>
                  {c.day ?? 0}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          规则：在视频页停留一段时间或点击字幕单词，会自动在今天打勾。
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-sm font-semibold">学习消息</div>
        <div className="mt-2 space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
          <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/30">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">激活码获取</div>
            <div className="mt-1">
              没有激活码？请联系微信号：<span className="font-semibold text-[#602D89]">speakecho</span>
            </div>
          </div>
          <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900/30">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">开发中</div>
            <div className="mt-1">接下来会加入：学习日历热力图、单词回放片段更精准、复习算法。</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

