import { listLocalVideos } from "@/lib/data/localAssets";
import { AdminVideosTable } from "@/components/admin/AdminVideosTable";
import { isAdminUser } from "@/lib/auth/admin";

export default async function AdminVideosPage() {
  const ok = await isAdminUser();
  if (!ok) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
        无权限访问。
      </div>
    );
  }

  const videos = await listLocalVideos();
  return <AdminVideosTable videos={videos} />;
}

