import { notFound, permanentRedirect } from "next/navigation";

import { CreatorTvPlayer } from "@/components/creator-tv/creator-tv-player";
import styles from "@/components/creator-tv/creator-tv.module.css";
import { ActionLink } from "@/components/ui/design-system";
import { ErrorState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import { fetchPublicCreatorTvLinear, type PublicCreatorTvResponse } from "@/lib/creator-tv";
import { translatePublicCreator } from "@/lib/i18n/public-creator";
import { localizePath } from "@/lib/i18n/routing";
import { getRequestLocale } from "@/lib/i18n/server";

export default async function CreatorTvPage({ params }: { params: Promise<{ handle: string }> }) {
  const [{ handle }, locale] = await Promise.all([params, getRequestLocale()]);
  const [response, initialLinear] = await Promise.all([
    fetch(`${apiBaseUrl}/public/channels/${encodeURIComponent(handle)}/tv`, {
      cache: "no-store",
    }),
    fetchPublicCreatorTvLinear(handle),
  ]);
  if (response.status === 404) notFound();
  if (!response.ok) {
    return (
      <main className={styles.page}>
        <ErrorState
          title={translatePublicCreator(locale, "tv.loadErrorTitle")}
          description={translatePublicCreator(locale, "tv.loadErrorDescription")}
          action={
            <div className={styles.errorActions}>
              <ActionLink
                data-tv-focusable="true"
                data-tv-focus-id="creator-tv-retry"
                href={localizePath(`/c/${encodeURIComponent(handle)}/tv`, locale)}
              >
                {translatePublicCreator(locale, "tv.retry")}
              </ActionLink>
              <ActionLink
                tone="quiet"
                data-tv-focusable="true"
                data-tv-focus-id="creator-tv-channel"
                href={localizePath(`/c/${encodeURIComponent(handle)}`, locale)}
              >
                {translatePublicCreator(locale, "tv.backToChannel")}
              </ActionLink>
            </div>
          }
        />
      </main>
    );
  }

  const data = (await response.json()) as PublicCreatorTvResponse;
  if (data.redirectedFrom && data.canonicalHandle !== handle) {
    permanentRedirect(localizePath(`/c/${encodeURIComponent(data.canonicalHandle)}/tv`, locale));
  }

  return <CreatorTvPlayer initialData={data} initialLinear={initialLinear} />;
}
