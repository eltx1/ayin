import { apiBaseUrl } from "../../../lib/api";
import { CommunityFeed } from "../c/[handle]/community/community-feed";
export default async function CommunityPage() {
  const response = await fetch(`${apiBaseUrl}/community/feed`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = response.ok ? await response.json() : { items: [] };
  return (
    <main style={{ padding: "2rem var(--shell-gutter) 6rem" }}>
      <h1>Community</h1>
      <p>Updates from channels you follow.</p>
      <CommunityFeed items={data.items} />
    </main>
  );
}
