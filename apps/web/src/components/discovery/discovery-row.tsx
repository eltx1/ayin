"use client";

import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ContentRow } from "@/components/viewer/content-row";
import {
  MediaCard,
  MediaCardSkeleton,
  type MediaCardTone,
  type MediaCardVariant,
} from "@/components/viewer/media-card";
import { mediaAssetUrl } from "@/lib/channel";
import { translateKidsDiscoverySource } from "@/lib/i18n/kids";
import { discoveryRowTitle, homeSectionAnchor, localizedMediaTitle } from "@/lib/home-presentation";
import { withViewerReadDeadline } from "@/lib/viewer-bootstrap";
import {
  fetchDiscoveryRow,
  fetchKidsDiscoveryRow,
  fetchMyAyinSection,
  type DiscoveryItem,
  type DiscoveryRowData,
} from "@/lib/discovery";

import styles from "./discovery.module.css";

interface DiscoveryRowProperties {
  authenticated: boolean;
  row: DiscoveryRowData;
  scope?: "home" | "my-ayin";
  kidsMode?: boolean;
  automatic?: boolean;
}

export function DiscoveryRow({
  authenticated,
  row,
  scope = "home",
  kidsMode = false,
  automatic = false,
}: DiscoveryRowProperties) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState(row.items);
  const [cursor, setCursor] = useState(row.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function loadMore() {
    if (!cursor || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await withViewerReadDeadline(
        (signal) =>
          scope === "my-ayin"
            ? fetchMyAyinSection(row.key, cursor, signal)
            : kidsMode
              ? fetchKidsDiscoveryRow(row.key, cursor, signal)
              : fetchDiscoveryRow(row.key, cursor, authenticated, signal),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setItems((current) => mergeItems(current, page.items));
      setCursor(page.nextCursor);
    } catch {
      if (!controller.signal.aborted) setError(t("home.loadMoreError"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  }

  const variant = row.source === "CREATOR_TV" || automatic ? "landscape" : "poster";
  const rowTitle = discoveryRowTitle(locale, row, kidsMode, automatic);

  return (
    <div aria-busy={loading} className={styles.rowBlock}>
      <ContentRow
        {...(scope === "home" ? { anchorId: homeSectionAnchor(row.key) } : {})}
        rowId={`${scope}-${row.key}`}
        title={rowTitle}
        variant={variant}
      >
        {items.length > 0 ? (
          items.map((item) => (
            <DiscoveryCard
              item={item}
              key={`${item.type}:${item.id}`}
              kicker={
                kidsMode
                  ? translateKidsDiscoverySource(locale, row.source, item.kicker)
                  : automatic
                    ? ""
                    : item.kicker
              }
              variant={variant}
            />
          ))
        ) : (
          <div className={styles.emptyCard} role="status">
            <strong>
              {row.availability === "UNAVAILABLE"
                ? t("common.notAvailableYet")
                : t("common.nothingHereYet")}
            </strong>
            <span dir="auto">{row.emptyMessage}</span>
          </div>
        )}
        {loading
          ? Array.from({ length: 3 }, (_, index) => (
              <MediaCardSkeleton key={`loading-${row.key}-${index}`} variant={variant} />
            ))
          : null}
      </ContentRow>
      {cursor ? (
        <div className={styles.loadMoreLine}>
          <button
            className={styles.loadMoreButton}
            data-tv-focus-id={`${scope}-${row.key}-load-more`}
            data-tv-focusable="true"
            disabled={loading}
            onClick={() => void loadMore()}
            type="button"
          >
            {loading ? t("common.loading") : t("common.loadMore")}
          </button>
          {error ? (
            <span aria-live="polite" className={styles.errorText} dir="auto" role="status">
              {error}
            </span>
          ) : null}
        </div>
      ) : error ? (
        <p aria-live="polite" className={styles.errorText} dir="auto" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DiscoveryCard({
  item,
  kicker,
  variant,
}: {
  item: DiscoveryItem;
  kicker: string;
  variant: MediaCardVariant;
}) {
  const { href, t, locale } = useI18n();
  const progress = item.progress?.positionMs
    ? t("home.resumeAt", { position: formatPosition(item.progress.positionMs) })
    : null;
  const meta = [item.meta, progress].filter(Boolean).join(" · ");
  const artworkUrl = item.artworkObjectKey ? mediaAssetUrl(item.artworkObjectKey) : null;
  const runtime = item.meta?.match(/(?:^| · )(\d{1,2}:\d{2}(?::\d{2})?)$/)?.[1];
  return (
    <MediaCard
      {...(artworkUrl ? { artworkUrl } : {})}
      {...(runtime ? { badge: runtime } : {})}
      href={href(item.href)}
      kicker={kicker}
      {...(meta ? { meta } : {})}
      title={localizedMediaTitle(item.title, locale)}
      tone={toneFor(item.id)}
      variant={variant}
    />
  );
}

function mergeItems(current: DiscoveryItem[], incoming: DiscoveryItem[]): DiscoveryItem[] {
  const seen = new Set(current.map((item) => `${item.type}:${item.id}`));
  return [
    ...current,
    ...incoming.filter((item) => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

function toneFor(value: string): MediaCardTone {
  const score = [...value].reduce((sum, character) => sum + character.codePointAt(0)!, 0);
  return ((score % 5) + 1) as MediaCardTone;
}

function formatPosition(positionMs: number): string {
  const seconds = Math.max(0, Math.floor(positionMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
