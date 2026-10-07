"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl, type AyinIdentity } from "@/lib/api";
import { translatePublicDiscovery } from "@/lib/i18n/public-discovery";
import { readViewerIdentity, sameViewerIdentity } from "@/lib/viewer-bootstrap";

import styles from "./page.module.css";

export function SessionPanel({ showWelcome }: { showWelcome: boolean }) {
  const { href, t, locale } = useI18n();
  const copy = (key: Parameters<typeof translatePublicDiscovery>[1]) =>
    translatePublicDiscovery(locale, key);
  const {
    retryNavigation,
    bootstrapRevision,
    bootstrapSuspended,
    audienceStatus,
    identity: currentIdentity,
    identityRevision,
    isAudienceCurrent,
  } = useViewerProduct();
  const [read, setRead] = useState<{
    revision: number;
    status: "ready" | "error";
    identity: AyinIdentity | null;
  } | null>(null);

  useEffect(() => {
    if (bootstrapSuspended) return;
    const controller = new AbortController();
    void readViewerIdentity(controller.signal)
      .then((identity) => {
        if (!controller.signal.aborted)
          setRead({ revision: bootstrapRevision, status: "ready", identity });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setRead({ revision: bootstrapRevision, status: "error", identity: null });
      });
    return () => controller.abort();
  }, [bootstrapRevision, bootstrapSuspended]);

  async function logout() {
    if (!isAudienceCurrent()) return;
    await fetch(`${apiBaseUrl}/auth/logout`, { method: "POST", credentials: "include" }).catch(
      () => undefined,
    );
    setRead(null);
    // A same-Home sign-out changes the audience without changing the route.
    // Re-read current server truth even when the logout response was lost.
    retryNavigation();
  }

  const currentRead = !bootstrapSuspended && read?.revision === bootstrapRevision ? read : null;
  const unavailable =
    !bootstrapSuspended &&
    (currentRead?.status === "error" ||
      audienceStatus === "error" ||
      (currentRead?.status === "ready" &&
        audienceStatus === "ready" &&
        !sameViewerIdentity(currentRead.identity, currentIdentity)));
  if (unavailable) {
    return (
      <div className={styles.sessionCard} role="alert">
        <p>{copy("session.error")}</p>
        <button
          className={styles.textButton}
          data-tv-focus-id="session-retry"
          data-tv-focusable="true"
          onClick={retryNavigation}
          type="button"
        >
          {copy("session.retry")}
        </button>
      </div>
    );
  }
  if (!currentRead || audienceStatus !== "ready" || !isAudienceCurrent()) {
    return (
      <div className={styles.accountSlot} role="status">
        {copy("session.loading")}
      </div>
    );
  }
  const identity = currentRead.identity;

  if (!identity) {
    return (
      <div className={styles.actions}>
        <Link
          className={styles.secondaryAction}
          data-tv-focus-id="session-sign-in"
          data-tv-focusable="true"
          href={href("/login")}
        >
          {t("session.signIn")}
        </Link>
        <Link
          className={styles.primaryAction}
          data-tv-focus-id="session-create-ayin"
          data-tv-focusable="true"
          href={href("/register")}
        >
          {t("session.createAyin")}
        </Link>
      </div>
    );
  }

  return (
    <div
      className={styles.sessionCard}
      data-private-viewer-state
      key={`${bootstrapRevision}:${identityRevision}`}
    >
      {showWelcome ? (
        <p className={styles.readyMessage} role="status">
          {t("session.ready")}
        </p>
      ) : null}
      <p className={styles.signedIn}>
        {t("session.signedInAs", { name: identity.account.displayName })}
      </p>
      <div className={styles.identityLine}>
        <span>@{identity.channel.handle}</span>
        <span aria-hidden="true">•</span>
        <span>{identity.creatorTv.name}</span>
      </div>
      <button
        className={styles.textButton}
        data-tv-focus-id="session-log-out"
        data-tv-focusable="true"
        onClick={logout}
        type="button"
      >
        {t("session.logOut")}
      </button>
    </div>
  );
}
