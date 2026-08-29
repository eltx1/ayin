"use client";

import { useState } from "react";

import { ContentRow } from "@/components/viewer/content-row";
import {
  MediaCard,
  MediaCardSkeleton,
  type MediaCardTone,
  type MediaCardVariant,
} from "@/components/viewer/media-card";
import {
  fetchDiscoveryRow,
  fetchMyAyinSection,
  type DiscoveryItem,
  type DiscoveryRowData,
} from "@/lib/discovery";

import styles from "./discovery.module.css";

interface DiscoveryRowProperties {
  authenticated: boolean;
  row: DiscoveryRowData;
  scope?: "home" | "my-ayin";
}

export function DiscoveryRow({ authenticated, row, scope = "home" }: DiscoveryRowProperties) {
  const [items, setItems] = useState(row.items);
  const [cursor, setCursor] = useState(row.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page =
        scope === "my-ayin"
          ? await fetchMyAyinSection(row.key, cursor)
          : await fetchDiscoveryRow(row.key, cursor, authenticated);
      setItems((current) => mergeItems(current, page.items));
      setCursor(page.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load more right now.");
    } finally {
      setLoading(false);
    }
  }

  const variant = row.source === "CREATOR_TV" ? "landscape" : "poster";

  return (
    <div className={styles.rowBlock}>
      <ContentRow rowId={`${scope}-${row.key}`} title={row.title}>
        {items.length > 0 ? (
          items.map((item) => <DiscoveryCard item={item} key={`${item.type}:${item.id}`} variant={variant} />)
        ) : (
          <div className={styles.emptyCard} role="status">
            <strong>{row.availability === "UNAVAILABLE" ? "Not available yet" : "Nothing here yet"}</strong>
            <span>{row.emptyMessage}</span>
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
            {loading ? "Loading…" : "Load more"}
          </button>
          {error ? <span className={styles.errorText}>{error}</span> : null}
        </div>
      ) : error ? (
        <p className={styles.errorText}>{error}</p>
      ) : null}
    </div>
  );
}

function DiscoveryCard({
  item,
  variant,
}: {
  item: DiscoveryItem;
  variant: MediaCardVariant;
}) {
  const progress = item.progress?.positionMs
    ? `Resume at ${formatPosition(item.progress.positionMs)}`
    : null;
  return (
    <MediaCard
      href={item.href}
      kicker={item.kicker}
      meta={[item.meta, progress].filter(Boolean).join(" · ") || undefined}
      title={item.title}
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
