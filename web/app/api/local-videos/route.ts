import { NextResponse } from "next/server";
import { listLocalVideos } from "@/lib/data/localAssets";

export async function GET() {
  const videos = await listLocalVideos();
  return NextResponse.json({ count: videos.length, videos });
}

