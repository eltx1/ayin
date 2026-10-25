"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { WatchRecommendation } from "@/lib/ayin-player";
import { mediaAssetUrl } from "@/lib/channel";
import { formatMediaDuration, localizedMediaTitle } from "@/lib/home-presentation";
import { translatePublicDiscovery } from "@/lib/i18n/public-discovery";
import { MediaArtwork } from "./media-artwork";
import styles from "./watch-recommendations.module.css";

export function WatchRecommendations({
  items,
  related,
  channelName,
  currentId,
}: {
  items: WatchRecommendation[];
  related: WatchRecommendation[];
  channelName: string;
  currentId: string;
}) {
  const { href, locale, t } = useI18n();
  const [creatorOnly, setCreatorOnly] = useState(false);
  const seen = new Set([currentId]);
  const visible = (creatorOnly ? related : items).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  if (!items.length && !related.length) return null;
  const heading = translatePublicDiscovery(locale, "watch.recommended");
  return (
    <aside className={styles.sidebar} aria-label={heading}>
      <header className={styles.heading}>
        <div>
          <p>{translatePublicDiscovery(locale, "watch.recommendedDescription")}</p>
          <h2>{heading}</h2>
        </div>
        <span aria-hidden="true">↗</span>
      </header>
      {related.length > 0 &&
      items.some((item) => !related.some((other) => other.id === item.id)) ? (
        <div className={styles.filters}>
          <button type="button" aria-pressed={!creatorOnly} onClick={() => setCreatorOnly(false)}>
            {heading}
          </button>
          <button type="button" aria-pressed={creatorOnly} onClick={() => setCreatorOnly(true)}>
            {t("watch.moreFrom", { name: channelName })}
          </button>
        </div>
      ) : null}
      <div className={styles.list}>
        {visible.map((item) => {
          const artwork = item.artworkObjectKey ? mediaAssetUrl(item.artworkObjectKey) : null;
          const duration = formatMediaDuration(item.durationMs);
          return (
            <Link
              className={styles.card}
              href={href(item.href)}
              key={item.id}
              data-tv-focusable="true"
              data-tv-focus-id={`watch-suggestion-${item.id}`}
            >
              <div className={styles.artwork}>
                <span className={styles.fallback} aria-hidden="true">
                  AYIN
                </span>
                {artwork ? (
                  <MediaArtwork src={artwork} sizes="(max-width: 600px) 44vw, 180px" />
                ) : null}
                {duration ? (
                  <span className={styles.duration} dir="ltr">
                    {duration}
                  </span>
                ) : null}
              </div>
              <div className={styles.copy}>
                <strong dir="auto" title={item.title}>
                  {localizedMediaTitle(item.title, locale)}
                </strong>
                <span dir="auto">{item.channelName ?? channelName}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
