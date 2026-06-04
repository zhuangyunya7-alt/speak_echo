import { IcpBeianLink } from "@/components/IcpBeianLink";
import { FiltersBar } from "@/components/videos/FiltersBar";
import { VideoCard } from "@/components/videos/VideoCard";
import { listVideos } from "@/lib/data/videos";
import { LearningSidebarClientOnly } from "@/components/home/LearningSidebarClientOnly";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const l1 = typeof sp.l1 === "string" ? sp.l1 : undefined;
  const l2 = typeof sp.l2 === "string" ? sp.l2 : undefined;
  const level = typeof sp.level === "string" ? sp.level : undefined;
  const creator = typeof sp.creator === "string" ? sp.creator : undefined;
  const duration =
    sp.duration === "short" || sp.duration === "mid" || sp.duration === "long" ? sp.duration : undefined;

  const [all, videos] = await Promise.all([listVideos({}), listVideos({ l1, l2, level, creator, duration })]);
  const creators = Array.from(new Set(all.map((v) => v.author))).sort((a, b) => a.localeCompare(b));

  return (
    <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col">
    <div className="grid flex-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="hidden lg:block">
        <LearningSidebarClientOnly />
      </div>
      <div className="space-y-6">
        <section className="hidden lg:block rounded-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-sm font-medium text-zinc-500 dark:text-zinc-400">精选视频 → 交互式英语练习</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">用听力对齐文字，用语境记住单词</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                词级同步高亮、点词即查、一键收藏到闪卡，专注于职场、成长、商业、科技与生活场景。
              </p>
            </div>
          </div>
        </section>

        <FiltersBar creators={creators} />

        {videos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            当前筛选条件下没有找到视频。
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )}
      </div>
    </div>
    <IcpBeianLink className="mt-10 pb-4" />
    </div>
  );
}
