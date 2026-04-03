"use client";

import { createSupabaseBrowserClient, safeGetBrowserUser } from "@/lib/supabase/browser";
import { readRecord, writeRecord, type RecordState } from "@/lib/record/client";
import { addLearnedDate, readLearnedDates, todayKey, writeLearnedDates } from "@/lib/learning/learnedDates";

function dateToSql(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function getUserId() {
  const user = await safeGetBrowserUser();
  return user?.id ?? null;
}

export async function markLearnedToday() {
  const key = todayKey();
  addLearnedDate(key);

  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  const uid = await getUserId();
  if (!uid) return;

  try {
    await supabase.from("learning_days").upsert({ user_id: uid, day: key }, { onConflict: "user_id,day" });
  } catch {
    // Best-effort sync; local markers already updated.
  }
}

export async function addWatchSecondsSynced(deltaSeconds: number) {
  if (deltaSeconds <= 0) return;

  // local fallback (also supports offline)
  const state = readRecord();
  const key = todayKey();
  const next: RecordState = {
    totalSeconds: state.totalSeconds + deltaSeconds,
    byDaySeconds: { ...state.byDaySeconds, [key]: (state.byDaySeconds[key] ?? 0) + deltaSeconds },
  };
  writeRecord(next);

  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  const uid = await getUserId();
  if (!uid) return;

  // read-modify-write (good enough for MVP)
  let data: { seconds?: number } | null = null;
  try {
    const res = await supabase
      .from("learning_time_daily")
      .select("seconds")
      .eq("user_id", uid)
      .eq("day", key)
      .maybeSingle();
    data = res.data;
  } catch {
    return;
  }

  const prev = typeof data?.seconds === "number" ? data.seconds : 0;
  const seconds = prev + Math.round(deltaSeconds);

  try {
    await supabase.from("learning_time_daily").upsert(
      { user_id: uid, day: key, seconds, updated_at: new Date().toISOString() },
      { onConflict: "user_id,day" },
    );
  } catch {
    // ignore network errors
  }
}

export async function loadLearningFromSupabase() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  const uid = await getUserId();
  if (!uid) return null;

  let daysRes;
  let timeRes;
  try {
    [daysRes, timeRes] = await Promise.all([
      supabase.from("learning_days").select("day").eq("user_id", uid),
      supabase.from("learning_time_daily").select("day,seconds").eq("user_id", uid),
    ]);
  } catch {
    return null;
  }

  if (daysRes.error || timeRes.error) return null;

  const learned = (daysRes.data ?? []).map((r: { day: unknown }) => String(r.day));
  const byDaySeconds: Record<string, number> = {};
  let totalSeconds = 0;
  for (const row of (timeRes.data ?? []) as Array<{ day: unknown; seconds?: unknown }>) {
    const day = String(row.day);
    const sec = typeof row.seconds === "number" ? row.seconds : 0;
    byDaySeconds[day] = sec;
    totalSeconds += sec;
  }

  // Mirror into localStorage so UI stays responsive even if Supabase is slow later
  writeLearnedDates(learned);
  writeRecord({ totalSeconds, byDaySeconds });

  return { learned, totalSeconds, byDaySeconds };
}

export function mergeLocalLearningIntoSupabaseOnLogin() {
  // Best-effort: push local learned_dates and today time snapshot.
  // Called from UI after login (not blocking).
  const learned = readLearnedDates();
  const record = readRecord();

  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;

  safeGetBrowserUser().then((user) => {
    const uid = user?.id;
    if (!uid) return;

    if (learned.length > 0) {
      const rows = learned.map((d) => ({ user_id: uid, day: d }));
      supabase.from("learning_days").upsert(rows, { onConflict: "user_id,day" }).catch(() => {});
    }

    const today = dateToSql(new Date());
    const sec = Math.round(record.byDaySeconds[today] ?? 0);
    if (sec > 0) {
      supabase.from("learning_time_daily").upsert(
        { user_id: uid, day: today, seconds: sec, updated_at: new Date().toISOString() },
        { onConflict: "user_id,day" },
      ).catch(() => {});
    }
  }).catch(() => {});
}

