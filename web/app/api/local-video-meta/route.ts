import path from "path";
import { writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/auth/admin";
import { contentInboxDir } from "@/lib/paths/contentInbox";

function safeBase(input: unknown) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export async function POST(request: Request) {
  // Dev-only endpoint: write meta file alongside local assets.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ok = await isAdminUser();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body: unknown = await request.json().catch(() => null);
  const base = safeBase(isRecord(body) ? body.base : null);
  if (!base) return NextResponse.json({ error: "Invalid base" }, { status: 400 });

  const payload = {
    title: isRecord(body) && typeof body.title === "string" ? body.title.trim() : "",
    level: isRecord(body) && typeof body.level === "string" ? body.level.trim() : "",
    category: isRecord(body) && typeof body.category === "string" ? body.category.trim() : "",
    categories: isRecord(body) && Array.isArray(body.categories)
      ? body.categories.filter((x: unknown) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [],
    author: isRecord(body) && typeof body.author === "string" ? body.author.trim() : "",
    description: isRecord(body) && typeof body.description === "string" ? body.description.trim() : "",
  };

  const filePath = path.join(contentInboxDir(), `${base}.meta.json`);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  return NextResponse.json({ ok: true });
}

