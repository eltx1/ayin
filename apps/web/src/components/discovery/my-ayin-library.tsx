"use client";

import { useEffect, useState } from "react";

import { useMyAyinI18n, localizeMyAyinSection } from "@/lib/i18n/my-ayin";
import { apiBaseUrl } from "@/lib/api";
import { parseMyAyinResponse } from "@/lib/my-ayin-contracts";
import { ActionButton, ActionLink, StatusNotice } from "@/components/ui/design-system";
import { ErrorState } from "@/components/viewer/view-states";

import { DiscoverySkeleton } from "./discovery-home";
import { DiscoveryRow } from "./discovery-row";
import styles from "./discovery.module.css";

type LibraryState = "loading" | "ready" | "signed-out" | "error";

export function MyAyinLibrary() {
  const { locale, href, t } = useMyAyinI18n();
  const [library, setLibrary] = useState<ReturnType<typeof parseMyAyinResponse> | null>(null);
  const [state, setState] = useState<LibraryState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const identity = await fetch(`${apiBaseUrl}/auth/me`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (identity.status === 401) {
          setLibrary(null);
          setState("signed-out");
          return;
        }
        if (!identity.ok) throw new Error("IDENTITY_UNAVAILABLE");

        const response = await fetch(`${apiBaseUrl}/discovery/my-ayin`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setLibrary(null);
          setState("signed-out");
          return;
        }
        if (!response.ok) throw new Error("MY_AYIN_UNAVAILABLE");

        setLibrary(parseMyAyinResponse(await response.json()));
        setState("ready");
      } catch {
        if (!controller.signal.aborted) {
          setLibrary(null);
          setState("error");
        }
      }
    })();

    return () => controller.abort();
  }, [attempt]);

  function retry() {
    setState("loading");
    setAttempt((value) => value + 1);
  }

  if (state === "loading") {
    return (
      <div className={styles.libraryState}>
        <StatusNotice announce="polite">{t("myAyin.loading")}</StatusNotice>
        <DiscoverySkeleton />
      </div>
    );
  }

  if (state === "signed-out") {
    return (
      <div className={styles.libraryState}>
        <ErrorState
          title={t("myAyin.signInTitle")}
          description={t("myAyin.signInDescription")}
          action={
            <ActionLink tone="primary" href={href("/login")}>
              {t("myAyin.signIn")}
            </ActionLink>
          }
        />
      </div>
    );
  }

  if (state === "error" || !library) {
    return (
      <div className={styles.libraryState}>
        <ErrorState
          title={t("myAyin.loadErrorTitle")}
          description={t("myAyin.loadErrorDescription")}
          action={
            <ActionButton
              type="button"
              tone="secondary"
              data-tv-focusable="true"
              data-tv-focus-id="my-ayin-retry"
              onClick={retry}
            >
              {t("myAyin.retry")}
            </ActionButton>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.rows}>
      {library.sections.map((section) => (
        <DiscoveryRow
          authenticated
          key={section.key}
          row={localizeMyAyinSection(locale, section)}
          scope="my-ayin"
        />
      ))}
    </div>
  );
}
