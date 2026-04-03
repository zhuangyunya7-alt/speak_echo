import Link from "next/link";
import type { Video } from "@/lib/domain/types";
import { LocalVideoThumb } from "@/components/videos/LocalVideoThumb";

function formatDuration(sec?: number | null) {
  if (!sec && sec !== 0) return null;
  if (sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoCard({ video }: { video: Video }) {
  const duration = formatDuration(video.duration_sec);
  const date = video.published_at ? new Date(video.published_at).toLocaleDateString() : null;
  const topicText =
    Array.isArray(video.categories) && video.categories.length > 0 ? video.categories.join(" / ") : video.category;

  return (
    <Link
      href={`/v/${video.id}`}
      className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white transition hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
        <LocalVideoThumb videoUrl={video.video_url} alt={video.title} fallbackCoverUrl={video.cover_url} />
        <div className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
        <div className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
          {video.level}
        </div>
        {duration ? (
          <div className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
            {duration}
          </div>
        ) : null}
      </div>
      <div className="p-4">
        <div className="line-clamp-2 text-sm font-semibold leading-5">{video.title}</div>
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <div className="truncate">
            {video.author} · {topicText}
          </div>
          {date ? <div className="shrink-0">{date}</div> : null}
        </div>
      </div>
    </Link>
  );
}

