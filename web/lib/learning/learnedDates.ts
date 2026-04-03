"use client";

const KEY = "speakecho.learned_dates.v1";

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function readLearnedDates(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeLearnedDates(dates: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(dates));
}

export function addLearnedDate(dateKey: string) {
  const dates = readLearnedDates();
  if (dates.includes(dateKey)) return;
  writeLearnedDates([dateKey, ...dates].sort());
}

export function addLearnedToday() {
  addLearnedDate(todayKey());
}

