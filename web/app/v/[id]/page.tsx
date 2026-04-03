import { notFound } from "next/navigation";
import { getVideoById } from "@/lib/data/videos";
import { getSubtitlesByVideoId } from "@/lib/data/subtitles";
import { InteractivePlayer } from "@/components/player/InteractivePlayer";
import { isAdminUser } from "@/lib/auth/admin";

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await getVideoById(id);
  if (!video) return notFound();
  const subtitles = await getSubtitlesByVideoId(id);
  const isAdmin = await isAdminUser();

  return <InteractivePlayer video={video} subtitles={subtitles} isAdmin={isAdmin} />;
}

