import { NextRequest, NextResponse } from "next/server";

type MyMemoryResponse = {
  responseData?: {
    translatedText?: string;
  };
};

async function translateMyMemory(text: string): Promise<string | null> {
  const upstream = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
  const res = await fetch(upstream, { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as MyMemoryResponse;
  const translated = json.responseData?.translatedText?.trim() ?? "";
  return translated || null;
}

/** Unofficial Google Translate endpoint (often works when MyMemory 429). */
async function translateGtx(text: string): Promise<string | null> {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=" +
    encodeURIComponent(text);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  const row = data[0] as unknown[];
  const parts: string[] = [];
  for (const chunk of row) {
    if (Array.isArray(chunk) && typeof chunk[0] === "string") parts.push(chunk[0]);
  }
  const t = parts.join("").trim();
  return t || null;
}

export async function GET(request: NextRequest) {
  const text = request.nextUrl.searchParams.get("text")?.trim() ?? "";
  if (!text) return NextResponse.json({ error: "missing text" }, { status: 400 });

  try {
    let translated = await translateMyMemory(text);
    if (!translated) translated = await translateGtx(text);
    if (!translated) {
      return NextResponse.json({ error: "translation_unavailable" }, { status: 502 });
    }
    return NextResponse.json({ translated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

