"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { getManagedTvStatus, TvManagementError } from "@/lib/creator-tv-management";
import {
  CreatorTvStatusError,
  getCreatorTvStatus,
  type CreatorTvStatus as Snapshot,
} from "@/lib/creator-tv-status";
import styles from "./creator-tv.module.css";

export function CreatorTvStatus({
  tvChannelId,
  accountId,
  channelId,
}: {
  tvChannelId: string;
  accountId?: string;
  channelId?: string;
}) {
  const { t, href, formatDate, formatNumber } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setSnapshot(null);
    setError(false);
    setSignIn(false);
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result =
        accountId && channelId
          ? await getManagedTvStatus(tvChannelId, { accountId, channelId }, controller.signal)
          : await getCreatorTvStatus(tvChannelId, controller.signal);
      if (!controller.signal.aborted) setSnapshot(result);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(true);
        setSignIn(
          (caught instanceof CreatorTvStatusError || caught instanceof TvManagementError) &&
            [401, 403].includes(caught.status),
        );
      }
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) {
        setBusy(false);
        if (controller.signal.aborted) setError(true);
      }
    }
  }, [tvChannelId, accountId, channelId]);
  useEffect(() => {
    // Defer state changes until after mount; abort superseded or unmounted reads.
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    let active = true;
    const refresh = () => {
      void load();
    };
    window.addEventListener("focus", refresh);
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    window.addEventListener("pageshow", restored);
    const hide = () => request.current?.abort();
    window.addEventListener("pagehide", hide);
    return () => {
      active = false;
      const current = request.current;
      request.current = null;
      current?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("pagehide", hide);
    };
  }, [load]);
  const output = snapshot?.output;
  const outputLabel =
    output &&
    (!output.configured
      ? "tvStatus.unconfigured"
      : output.available
        ? "tvStatus.ready"
        : output.status === "ERROR"
          ? "tvStatus.failed"
          : output.status === "STOPPED"
            ? "tvStatus.stopped"
            : "tvStatus.waiting");
  return (
    <section className={styles.managerCard} aria-labelledby="tv-output-heading" aria-busy={busy}>
      <div className={styles.managerHeader}>
        <h2 id="tv-output-heading">{t("tvStatus.title")}</h2>
        <button
          className={styles.backLink}
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          {t(error ? "tvStatus.retry" : "tvStatus.refresh")}
        </button>
      </div>
      {busy && <p role="status">{t("tvStatus.loading")}</p>}
      {error && <p role="alert">{t("tvStatus.error")}</p>}
      {signIn && (
        <Link className={styles.backLink} href={href("/login")}>
          {t("tvStatus.signIn")}
        </Link>
      )}
      {snapshot && outputLabel && (
        <>
          <dl className={styles.automationGrid}>
            <div className={styles.automationItem}>
              <dt>{t("tvStatus.schedule")}</dt>
              <dd>
                {snapshot.schedule.programCount === 0
                  ? t("tvStatus.empty")
                  : t("tvStatus.programs", { count: formatNumber(snapshot.schedule.programCount) })}
              </dd>
            </div>
            <div className={styles.automationItem}>
              <dt>{t("tvStatus.output")}</dt>
              <dd>{t(outputLabel)}</dd>
            </div>
            <div className={styles.automationItem}>
              <dt>{t("tvStatus.checked")}</dt>
              <dd>{formatDate(snapshot.checkedAt, { dateStyle: "medium", timeStyle: "short" })}</dd>
            </div>
          </dl>
          <p className={styles.muted}>{t("tvStatus.snapshot")}</p>
          {snapshot.fallback.enabled && <p className={styles.muted}>{t("tvStatus.fallback")}</p>}
          {snapshot.output.lastManifestAt && (
            <p className={styles.muted}>
              {t("tvStatus.manifest", {
                time: formatDate(snapshot.output.lastManifestAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
