"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  MetricList,
  PageHeader,
  StatusNotice,
} from "@/components/ui/design-system";
import { studioOverviewAr, studioOverviewEn } from "@/lib/i18n/resources/studio-overview";
import { getStudioOverviewSnapshot, type StudioOverviewSnapshot } from "@/lib/studio-overview";
import styles from "./studio-dashboard.module.css";
export function StudioDashboard() {
  const { locale, href, formatNumber } = useI18n();
  const copy = locale === "ar" ? studioOverviewAr : studioOverviewEn;
  const [data, setData] = useState<StudioOverviewSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const read = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    return getStudioOverviewSnapshot(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setData(next);
          setState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
  }, []);
  useEffect(() => {
    void load();
    return () => read.current?.abort();
  }, [load]);
  const refresh = () => {
    setData(null);
    setState("loading");
    void load();
  };
  const label = (key: string) => copy[key as keyof typeof copy];
  return (
    <>
      <PageHeader
        title={copy.overview}
        eyebrow={data?.channel.name ?? copy.title}
        description={copy.description}
        actions={
          <>
            <ActionLink href={href("/upload")} tone="primary">
              {copy.upload}
            </ActionLink>
            <ActionButton tone="secondary" disabled={state === "loading"} onClick={refresh}>
              {copy.refresh}
            </ActionButton>
          </>
        }
      />
      {state === "loading" && <StatusNotice announce="polite">{copy.loading}</StatusNotice>}
      {state === "error" && (
        <StatusNotice tone="danger" announce="assertive">
          {copy.error} <ActionButton onClick={refresh}>{copy.retry}</ActionButton>
        </StatusNotice>
      )}
      {data && (
        <>
          <MetricList
            label={copy.counters}
            items={[
              [copy.videos, data.counters.videos],
              [copy.published, data.counters.publishedVideos],
              [copy.subscribers, data.counters.subscribers],
              [copy.comments, data.counters.comments],
              [copy.playlists, data.counters.playlists],
            ].map(([label, value]) => ({
              label: String(label),
              value: formatNumber(Number(value)),
            }))}
          />
          <div className={styles.grid}>
            <section className={styles.panel}>
              <h2>{copy.recent}</h2>
              {data.recentUploads.length ? (
                <ul className={styles.uploads}>
                  {data.recentUploads.map((video) => (
                    <li key={video.id}>
                      <span dir="auto">{video.title}</span>
                      <DataBadge>{label(video.status)}</DataBadge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{copy.empty}</p>
              )}
              <ActionLink href={href("/studio/content")}>{copy.content}</ActionLink>
            </section>
            <section className={styles.panel}>
              <h2>{copy.audience}</h2>
              <p>{copy.audienceCopy}</p>
              <div className={styles.actions}>
                <ActionLink href={href("/studio/comments")}>{copy.comments}</ActionLink>
                <ActionLink href={href("/studio/community")}>{copy.community}</ActionLink>
                <ActionLink href={href("/studio/live")}>{copy.live}</ActionLink>
              </div>
            </section>
            <section className={styles.panel}>
              <h2>{copy.analytics}</h2>
              <p>{copy.analyticsCopy}</p>
              <ActionLink href={href("/studio/analytics")}>{copy.analytics}</ActionLink>
            </section>
            <section className={styles.panel}>
              <h2>{copy.monetization}</h2>
              <MetricList
                label={copy.monetization}
                items={[
                  { label: copy.contract, value: label(data.monetization.contractStatus) },
                  ...(data.monetization.revenueShareBps === null
                    ? []
                    : [
                        {
                          label: copy.share,
                          value: formatNumber(data.monetization.revenueShareBps / 10000, {
                            style: "percent",
                            maximumFractionDigits: 2,
                          }),
                        },
                      ]),
                ]}
              />
              <p>{copy.revenueCopy}</p>
              <ActionLink href={href("/studio/monetization")}>{copy.monetization}</ActionLink>
            </section>
          </div>
          <details className={styles.panel}>
            <summary>{copy.advanced}</summary>
            <div className={styles.actions}>
              <ActionLink href={href("/studio/tv")}>{copy.tv}</ActionLink>
              <ActionLink href={href("/studio/channel")}>{copy.channel}</ActionLink>
              <ActionLink href={href("/studio/playlists")}>{copy.playlists}</ActionLink>
              <ActionLink href={href("/studio/support")}>{copy.support}</ActionLink>
            </div>
          </details>
        </>
      )}
    </>
  );
}
