import path from "path";
import { createReadStream } from "fs";
import { readFile, stat } from "fs/promises";
import { Readable } from "stream";
import { NextResponse } from "next/server";

import { contentInboxDir, isAllowedInboxFilename } from "@/lib/paths/contentInbox";

function contentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  return "application/octet-stream";
}

function isStreamableVideo(name: string): boolean {
  return /\.(mp4|webm|mov|m4v)$/i.test(name);
}

/**
 * Parse first `Range: bytes=` value. Supports `start-end`, `start-`, `0-`.
 * Does not handle suffix ranges (`bytes=-500`).
 */
function parseBytesRange(
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return null;
  const startStr = m[1] ?? "";
  const endStr = m[2] ?? "";
  let start = startStr === "" ? 0 : parseInt(startStr, 10);
  let end = endStr === "" ? size - 1 : parseInt(endStr, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (startStr === "" && endStr !== "") {
    // Would be suffix form `bytes=-n`; not used by typical video seeks.
    return null;
  }
  if (endStr === "") end = size - 1;
  return { start, end };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ name: string }> },
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { name: raw } = await context.params;
  const name = decodeURIComponent(raw);
  if (!isAllowedInboxFilename(name)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const filePath = path.join(contentInboxDir(), name);

  try {
    const st = await stat(filePath);
    const size = st.size;
    const type = contentType(name);

    if (isStreamableVideo(name)) {
      const parsed = parseBytesRange(request.headers.get("range"), size);
      if (parsed) {
        let { start, end } = parsed;
        if (start >= size) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${size}`,
            },
          });
        }
        end = Math.min(end, size - 1);
        if (start > end) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${size}`,
            },
          });
        }
        const chunkLength = end - start + 1;
        const nodeStream = createReadStream(filePath, { start, end });
        const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
        return new NextResponse(webStream, {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunkLength),
            "Content-Type": type,
            "Cache-Control": "no-store",
          },
        });
      }
    }

    const buf = await readFile(filePath);
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Cache-Control": "no-store",
    };
    if (isStreamableVideo(name)) {
      headers["Accept-Ranges"] = "bytes";
      headers["Content-Length"] = String(size);
    }
    return new NextResponse(buf, { headers });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
