import { apiBaseUrl } from "../../../../../lib/api";
import { CommunityFeed } from "./community-feed";
export default async function ChannelCommunityPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const response = await fetch(
    `${apiBaseUrl}/public/community/channels/${encodeURIComponent(handle)}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    return (
      <main style={{ padding: "2rem var(--shell-gutter)" }}>
        <h1>Community unavailable</h1>
      </main>
    );
  const data = await response.json();
  return (
    <main style={{ padding: "2rem var(--shell-gutter) 6rem" }}>
      <h1>{data.channel.name} Community</h1>
      <CommunityFeed items={data.items} />
    </main>
  );
}
