"use client";

import type { Video } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { LocalVideoMetaEditor } from "@/components/player/LocalVideoMetaEditor";

export function VideoPane({
  video,
  videoRef,
  playbackRate,
  rates,
  onChangeRate,
  localAssetBase,
  canEdit,
}: {
  video: Video;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playbackRate: number;
  rates: number[];
  onChangeRate: (r: number) => void;
  localAssetBase: string | null;
  canEdit: boolean;
}) {
  const topicText =
    Array.isArray(video.categories) && video.categories.length > 0
      ? video.categories.join(" · ")
      : (video.category ?? "").trim();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{video.title}</h1>
          {topicText ? (
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{topicText}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && localAssetBase ? (
            <LocalVideoMetaEditor
              base={localAssetBase}
              initial={{
                title: video.title,
                level: video.level ?? "",
                categories: Array.isArray(video.categories) && video.categories.length > 0 ? video.categories : [video.category ?? ""].filter(Boolean),
                author: video.author ?? "",
                description: video.description ?? "",
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-black dark:border-zinc-800">
        <video
          ref={videoRef}
          className="h-full w-full"
          controls
          playsInline
          preload="metadata"
          src={video.video_url}
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">倍速</span>
            {rates.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={r === playbackRate ? "primary" : "ghost"}
                onClick={() => onChangeRate(r)}
                type="button"
              >
                {r}x
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-sm font-semibold">视频简介</div>
        <div className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {video.description ?? "（暂无简介）"}
        </div>
      </div>
    </div>
  );
}

