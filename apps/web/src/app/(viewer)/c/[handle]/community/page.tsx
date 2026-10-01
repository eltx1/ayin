import { permanentRedirect } from "next/navigation";

import { localizePath } from "@/lib/i18n/routing";
import { getRequestLocale } from "@/lib/i18n/server";

export default async function LegacyChannelCommunityPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const [{ handle }, locale] = await Promise.all([params, getRequestLocale()]);
  permanentRedirect(localizePath(`/c/${encodeURIComponent(handle)}?tab=posts`, locale));
}
