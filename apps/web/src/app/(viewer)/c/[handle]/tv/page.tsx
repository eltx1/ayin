import { notFound, permanentRedirect } from "next/navigation";

import { CreatorTvPlayer } from "@/components/creator-tv/creator-tv-player";
import { apiBaseUrl } from "@/lib/api";
import type { PublicCreatorTvResponse } from "@/lib/creator-tv";

export default async function CreatorTvPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const response = await fetch(`${apiBaseUrl}/public/channels/${encodeURIComponent(handle)}/tv`, {
    cache: "no-store",
  });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Creator TV could not be loaded right now.");

  const data = (await response.json()) as PublicCreatorTvResponse;
  if (data.redirectedFrom && data.canonicalHandle !== handle) {
    permanentRedirect(`/c/${encodeURIComponent(data.canonicalHandle)}/tv`);
  }

  return <CreatorTvPlayer initialData={data} />;
}
