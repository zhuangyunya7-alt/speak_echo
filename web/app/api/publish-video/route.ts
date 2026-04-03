import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const PublishBodySchema = z.object({
  title: z.string().trim().min(1),
  level: z.string().trim().min(1),
  category: z.string().trim().min(1),
  description: z.string().optional().default(""),
  video_url: z.string().url(),
  subtitle_url: z.string().url().optional(),
  vocab_url: z.string().url().optional(),
  vocab_display_url: z.string().url().optional(),
  /** Optional `{video_id}_phrases.json` sidecar (phrase underlines); signed like other COS JSON when private. */
  phrases_url: z.string().url().optional(),
  meta_url: z.string().url().optional(),
  cover_url: z.string().url().optional(),
  author: z.string().trim().optional(),
  published_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const expected = (process.env.PUBLISH_API_TOKEN ?? "").trim();
  const got = (req.headers.get("x-publish-token") ?? "").trim();
  if (expected && got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bodyRaw: unknown = await req.json().catch(() => null);
  const parsed = PublishBodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
  }

  const body = parsed.data;
  const row = {
    title: body.title,
    cover_url: body.cover_url || body.video_url,
    video_url: body.video_url,
    author: body.author?.trim() || "YouTube",
    level: body.level,
    category: body.category,
    description: body.description || "",
    subtitle_url: body.subtitle_url ?? null,
    vocab_url: body.vocab_url ?? null,
    vocab_display_url: body.vocab_display_url ?? null,
    phrases_url: body.phrases_url ?? null,
    meta_url: body.meta_url ?? null,
    published_at: body.published_at ?? new Date().toISOString(),
  };

  // Upsert-like behavior without hard DB unique requirement.
  const { data: existing, error: qErr } = await supabase
    .from("videos")
    .select("id")
    .eq("video_url", body.video_url)
    .limit(1)
    .maybeSingle();
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  if (existing?.id) {
    const { error: upErr } = await supabase.from("videos").update(row).eq("id", existing.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, mode: "updated", id: existing.id });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("videos")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, mode: "inserted", id: inserted?.id ?? null });
}

