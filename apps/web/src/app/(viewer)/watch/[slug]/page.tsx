import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translator";
import { absoluteUrl, metadataRobots } from "@/lib/seo";
import { getSeoVideo } from "@/lib/seo-content";
import { localizePath } from "@/lib/i18n/routing";
import { trustedApiRegionHeaders } from "@/lib/trusted-region";
import { WatchClient } from "./watch-client";

interface WatchPageProperties {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kids?: string | string[] }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: WatchPageProperties): Promise<Metadata> {
  const [{ slug }, query, locale] = await Promise.all([params, searchParams, getRequestLocale()]);
  // The API's host-only session cookie is not available to this server page.
  // Never embed a general title, poster or playable source before the browser
  // verifies its actual current audience against the API.
  const neutral: Metadata = {
    title: translate(locale, "watch.eyebrow"),
    robots: metadataRobots(false),
  };
  if (query.kids === "1") return neutral;
  try {
    // Existing public availability/territory authority controls indexability
    // only. Its source-bearing payload is never passed to the client or head.
    const video = await getSeoVideo(slug, await trustedApiRegionHeaders());
    if (!video) return neutral;
    return {
      ...neutral,
      robots: metadataRobots(video.visibility === "PUBLIC"),
      alternates: {
        canonical: absoluteUrl(localizePath(`/watch/${encodeURIComponent(video.slug)}`, locale)),
      },
    };
  } catch {
    return neutral;
  }
}

export default async function WatchPage({ params, searchParams }: WatchPageProperties) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <WatchClient slug={slug} explicitKids={query.kids === "1"} />;
}
