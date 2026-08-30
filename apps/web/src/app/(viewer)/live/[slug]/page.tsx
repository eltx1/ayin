import { LiveWatchClient } from "./live-watch-client";

export default async function LiveWatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LiveWatchClient slug={slug} />;
}
