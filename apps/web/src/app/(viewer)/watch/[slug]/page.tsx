import { notFound } from "next/navigation";

import { ContentDetailLayout } from "@/components/content/content-detail-layout";
import { AyinPlayer } from "@/components/player/ayin-player";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { type VideoContentDetailResponse, videoDetailViewModel } from "@/lib/content-detail";
import { mediaAssetUrl } from "@/lib/channel";

export default async function WatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const response = await fetch(`${apiBaseUrl}/public/content/videos/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error(await readApiError(response));

  const detail = (await response.json()) as VideoContentDetailResponse;
  const data = detail.playback;
  const sourceUrl = mediaAssetUrl(data.video.source.objectKey);
  if (!sourceUrl) {
    throw new Error("AYIN media delivery is not configured for this client.");
  }
  const captions = data.video.captions.flatMap((track) => {
    const src = mediaAssetUrl(track.objectKey);
    return src
      ? [
          {
            id: track.id,
            src,
            label: track.label,
            language: track.language,
            default: track.default,
          },
        ]
      : [];
  });

  return (
    <ContentDetailLayout
      detail={videoDetailViewModel(detail)}
      media={
        <AyinPlayer
          captions={captions}
          chapters={data.video.chapters}
          durationMs={data.video.durationMs}
          progressPolicy={data.playerPolicy}
          sourceUrl={sourceUrl}
          title={data.video.title}
          videoId={data.video.id}
        />
      }
    />
  );
}
