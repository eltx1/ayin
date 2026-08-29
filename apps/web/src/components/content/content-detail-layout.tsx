import Link from "next/link";
import type { ReactNode } from "react";

import { ContentRow } from "@/components/viewer/content-row";
import { MediaCard, type MediaCardTone } from "@/components/viewer/media-card";
import type { ContentDetailViewModel } from "@/lib/content-detail";

import styles from "./content-detail.module.css";

export function ContentDetailLayout({
  detail,
  media,
}: {
  detail: ContentDetailViewModel;
  media: ReactNode;
}) {
  return (
    <main className={styles.page} data-content-kind={detail.kind}>
      <div className={styles.media}>{media}</div>

      {detail.externalAdPlacements.includes("watch_below_player") ? (
        <div aria-hidden="true" data-ad-placement-key="watch_below_player" />
      ) : null}

      <section className={styles.summary}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{detail.kind.replaceAll("_", " ")}</p>
          <h1>{detail.title}</h1>
          <div className={styles.meta}>
            {detail.durationMs ? <span>{formatDuration(detail.durationMs)}</span> : null}
            {detail.publishedAt ? <span>{formatDate(detail.publishedAt)}</span> : null}
          </div>
          {detail.description ? <p className={styles.description}>{detail.description}</p> : null}
        </div>

        <div className={styles.actions}>
          {detail.creator ? (
            <Link
              className={styles.creator}
              data-tv-focus-id="content-creator"
              data-tv-focusable="true"
              href={`/c/${encodeURIComponent(detail.creator.handle)}`}
            >
              <strong>{detail.creator.name}</strong>
              <span>@{detail.creator.handle}</span>
            </Link>
          ) : null}
          {detail.saveHookReserved ? (
            <button
              className={styles.reservedAction}
              data-action-hook="save"
              disabled
              title="Saving will be enabled with AYIN social actions."
              type="button"
            >
              Save
            </button>
          ) : null}
        </div>
      </section>

      {detail.externalAdPlacements.includes("content_detail") ? (
        <div aria-hidden="true" data-ad-placement-key="content_detail" />
      ) : null}

      {detail.related.length > 0 ? (
        <ContentRow eyebrow="Keep watching" rowId="content-related" title="Related on AYIN">
          {detail.related.map((item) => (
            <MediaCard
              href={item.href}
              kicker={item.kicker}
              key={`${item.type}:${item.id}`}
              {...(item.meta ? { meta: item.meta } : {})}
              title={item.title}
              tone={toneFor(item.id)}
              variant="landscape"
            />
          ))}
        </ContentRow>
      ) : null}

      {detail.comments.enabled && detail.comments.reserved ? (
        <section className={styles.commentsSlot} data-content-slot="comments">
          <strong>Comments</strong>
          <span>Comments are not available on this surface yet.</span>
        </section>
      ) : null}
    </main>
  );
}

function formatDuration(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(
        date,
      );
}

function toneFor(value: string): MediaCardTone {
  const score = [...value].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0);
  return ((score % 5) + 1) as MediaCardTone;
}
