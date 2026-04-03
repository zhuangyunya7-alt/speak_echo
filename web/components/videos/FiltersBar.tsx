"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TOPIC_TAXONOMY, type TopicL1 } from "@/lib/domain/taxonomy";

const L1_OPTIONS = Object.keys(TOPIC_TAXONOMY) as TopicL1[];

const LEVELS = [
  { value: "★☆☆☆☆", label: "★☆☆☆☆（基础）" },
  { value: "★★☆☆☆", label: "★★☆☆☆（入门）" },
  { value: "★★★☆☆", label: "★★★☆☆（进阶）" },
  { value: "★★★★☆", label: "★★★★☆（高级）" },
  { value: "★★★★★", label: "★★★★★（母语级）" },
] as const;

const DURATIONS = [
  { value: "short", label: "短（< 5 分钟）" },
  { value: "mid", label: "中（5–10 分钟）" },
  { value: "long", label: "长（> 10 分钟）" },
] as const;

function Select({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TopicCascade({
  l1,
  l2,
  setTopic,
}: {
  l1: string;
  l2: string;
  setTopic: (next: { l1: string; l2: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hoverL1, setHoverL1] = useState<TopicL1 | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const label = useMemo(() => {
    if (l1 && l2) return `${l1} · ${l2}`;
    if (l1) return `${l1}（未选二级）`;
    return "话题";
  }, [l1, l2]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const l2List = hoverL1 ? [...TOPIC_TAXONOMY[hoverL1]] : [];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="flex h-10 min-w-[10rem] items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-left text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            const initial =
              l1 && L1_OPTIONS.includes(l1 as TopicL1) ? (l1 as TopicL1) : L1_OPTIONS[0];
            setHoverL1(initial);
            setOpen(true);
          }
        }}
      >
        <span className="truncate">{label}</span>
        <span className="text-zinc-400" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-50 flex max-h-[min(24rem,calc(100vh-8rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
          role="menu"
        >
          <div className="w-44 shrink-0 overflow-y-auto border-r border-zinc-200 py-1 dark:border-zinc-700">
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center border-b border-zinc-200 px-3 py-2 text-left text-sm text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              onMouseEnter={() => setHoverL1(null)}
              onFocus={() => setHoverL1(null)}
              onClick={() => {
                setTopic({ l1: "", l2: "" });
                setOpen(false);
              }}
            >
              不限
            </button>
            {L1_OPTIONS.map((x) => (
              <button
                key={x}
                type="button"
                role="menuitem"
                className={`flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                  hoverL1 === x ? "bg-violet-50 text-violet-900 dark:bg-violet-950/50 dark:text-violet-100" : ""
                }`}
                onMouseEnter={() => setHoverL1(x)}
                onFocus={() => setHoverL1(x)}
                onClick={() => setHoverL1(x)}
              >
                {x}
              </button>
            ))}
          </div>
          <div className="w-56 shrink-0 overflow-y-auto py-1">
            {!hoverL1 ? (
              <div className="px-3 py-6 text-center text-xs leading-relaxed text-zinc-500">
                点击左侧「不限」清除话题筛选。
                <br />
                将鼠标移到其他一级话题可查看二级标签。
              </div>
            ) : (
              <>
                <div className="border-b border-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-800">
                  {hoverL1} · 二级标签
                </div>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  onClick={() => {
                    setTopic({ l1: hoverL1, l2: "" });
                    setOpen(false);
                  }}
                >
                  仅按「{hoverL1}」筛选（不限二级）
                </button>
                {l2List.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="menuitem"
                    className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                      l1 === hoverL1 && l2 === t ? "bg-zinc-100 font-medium dark:bg-zinc-900" : ""
                    }`}
                    onClick={() => {
                      setTopic({ l1: hoverL1, l2: t });
                      setOpen(false);
                    }}
                  >
                    {t}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FiltersBar({ creators }: { creators: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);

  const l1 = searchParams.get("l1") ?? "";
  const l2 = searchParams.get("l2") ?? "";
  const level = searchParams.get("level") ?? "";
  const creator = searchParams.get("creator") ?? "";
  const duration = searchParams.get("duration") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  function setTopic(next: { l1: string; l2: string }) {
    const n = new URLSearchParams(params.toString());
    if (!next.l1) {
      n.delete("l1");
      n.delete("l2");
    } else {
      n.set("l1", next.l1);
      if (!next.l2) n.delete("l2");
      else n.set("l2", next.l2);
    }
    router.push(`${pathname}?${n.toString()}`);
  }

  function reset() {
    router.push(pathname);
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <TopicCascade l1={l1} l2={l2} setTopic={setTopic} />
          <Select
            value={level}
            onChange={(v) => setParam("level", v)}
            placeholder="难度等级"
            options={LEVELS.map((l) => ({ value: l.value, label: l.label }))}
          />
          <Select
            value={creator}
            onChange={(v) => setParam("creator", v)}
            placeholder="博主"
            options={creators.map((c) => ({ value: c, label: c }))}
          />
          <Select
            value={duration}
            onChange={(v) => setParam("duration", v)}
            placeholder="视频时长"
            options={DURATIONS.map((d) => ({ value: d.value, label: d.label }))}
          />
        </div>
        <Button variant="ghost" onClick={reset}>
          重置
        </Button>
      </div>
    </div>
  );
}
