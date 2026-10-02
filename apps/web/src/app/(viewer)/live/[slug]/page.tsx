import type { Metadata } from "next";

import { getRequestLocale } from "@/lib/i18n/server";
import { translateLiveViewer } from "@/lib/i18n/live-viewer";

import { LiveWatchClient } from "./live-watch-client";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translateLiveViewer(locale, "live.metaTitle"),
    description: translateLiveViewer(locale, "live.metaDescription"),
  };
}

export default async function LiveWatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LiveWatchClient slug={slug} />;
}
