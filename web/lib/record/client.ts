"use client";

export type RecordState = {
  totalSeconds: number;
  byDaySeconds: Record<string, number>;
};

const KEY = "speakecho.record.v1";

export function readRecord(): RecordState {
  if (typeof window === "undefined") return { totalSeconds: 0, byDaySeconds: {} };
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return { totalSeconds: 0, byDaySeconds: {} };
  try {
    const parsed = JSON.parse(raw) as RecordState;
    return {
      totalSeconds: typeof parsed.totalSeconds === "number" ? parsed.totalSeconds : 0,
      byDaySeconds: typeof parsed.byDaySeconds === "object" && parsed.byDaySeconds ? parsed.byDaySeconds : {},
    };
  } catch {
    return { totalSeconds: 0, byDaySeconds: {} };
  }
}

export function writeRecord(state: RecordState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function addWatchSeconds(deltaSeconds: number) {
  if (deltaSeconds <= 0) return;
  const state = readRecord();
  const d = new Date();
  const key = d.toISOString().slice(0, 10);
  const next: RecordState = {
    totalSeconds: state.totalSeconds + deltaSeconds,
    byDaySeconds: {
      ...state.byDaySeconds,
      [key]: (state.byDaySeconds[key] ?? 0) + deltaSeconds,
    },
  };
  writeRecord(next);
}

