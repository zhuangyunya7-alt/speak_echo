import { NextRequest, NextResponse } from "next/server";

import { resolvePlayableMediaUrl } from "@/lib/media/tencentCos";

function isAllowedUrl(url: string): boolean {
  // Allow Tencent COS vocab JSON URLs to avoid CORS.
  const isVocabJson =
    url.includes("_vocabulary_levels.json") ||
    url.includes("_vocab_display.json") ||
    /_phrases\.json/i.test(url) ||
    /_phrases_batch\.json/i.test(url);
  return (
    url.startsWith("https://") &&
    (url.includes(".cos.") || url.includes(".myqcloud.com")) &&
    isVocabJson
  );
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !isAllowedUrl(url)) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  try {
    const fetchUrl = (await resolvePlayableMediaUrl(url)) ?? url;
    const res = await fetch(fetchUrl, { cache: "force-cache" });
    if (!res.ok) return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 });
    const json = await res.json();
    return NextResponse.json(json);
  } catch {
    return NextResponse.json({ error: "Proxy failed" }, { status: 502 });
  }
}
