"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useMyAyinI18n, lensReasonKey } from "@/lib/i18n/my-ayin";
import {
  confirmLensReset,
  confirmNotInterested,
  parseLensResponse,
  type LensItem,
  type LensResponse,
} from "@/lib/my-ayin-contracts";
import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { MediaArtwork } from "@/components/viewer/media-artwork";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  StatusNotice,
} from "@/components/ui/design-system";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

import styles from "./lens.module.css";

type LensState = "loading" | "ready" | "signed-out" | "error";
type PendingAction = { kind: "not-interested"; videoId: string } | { kind: "reset" };
type UncertainAction = PendingAction;

export function AyinLensClient() {
  const router = useRouter();
  const { t, href, direction } = useMyAyinI18n();
  const [data, setData] = useState<LensResponse | null>(null);
  const [state, setState] = useState<LensState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [uncertain, setUncertain] = useState<UncertainAction | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const signIn = useCallback(() => router.push(href("/login")), [href, router]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/recommendations/home?limit=18`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setData(null);
          setState("signed-out");
          return null;
        }
        if (!response.ok) throw new Error("LENS_UNAVAILABLE");
        return parseLensResponse(await response.json());
      })
      .then((next) => {
        if (!next || controller.signal.aborted) return;
        setData(next);
        setState("ready");
        setUncertain(null);
        trackAnalyticsEvent("LENS_OPEN", { profileId: next.profileId });
        for (const item of next.items) {
          trackAnalyticsEvent("RECOMMENDATION_IMPRESSION", {
            profileId: next.profileId,
            videoId: item.id,
            channelId: item.channelId,
            metadata: { reason: item.reason.code, algorithm: next.algorithm },
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setData(null);
          setState("error");
        }
      });
    return () => controller.abort();
  }, [attempt, signIn]);

  function refresh() {
    if (pending) return;
    setState("loading");
    setAttempt((value) => value + 1);
  }

  async function notInterested(item: LensItem) {
    if (!data || pending || uncertain) return;
    setPending({ kind: "not-interested", videoId: item.id });
    try {
      const response = await fetch(`${apiBaseUrl}/recommendations/not-interested`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: data.profileId, videoId: item.id }),
      });
      if (response.status === 401) {
        signIn();
        return;
      }
      if (
        !response.ok ||
        !confirmNotInterested(await response.json(), data.profileId, item.id)
      ) {
        throw new Error("NOT_INTERESTED_UNCONFIRMED");
      }
      trackAnalyticsEvent("LENS_NOT_INTERESTED", {
        profileId: data.profileId,
        videoId: item.id,
        channelId: item.channelId,
      });
      setData({ ...data, items: data.items.filter((candidate) => candidate.id !== item.id) });
    } catch {
      setUncertain({ kind: "not-interested", videoId: item.id });
    } finally {
      setPending(null);
    }
  }

  async function resetPersonalization() {
    if (!data || pending || uncertain) return;
    setPending({ kind: "reset" });
    try {
      const response = await fetch(`${apiBaseUrl}/recommendations/reset`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: data.profileId }),
      });
      if (response.status === 401) {
        setResetOpen(false);
        signIn();
        return;
      }
      if (!response.ok || !confirmLensReset(await response.json(), data.profileId)) {
        throw new Error("RESET_UNCONFIRMED");
      }
      trackAnalyticsEvent("LENS_DISMISS", {
        profileId: data.profileId,
        metadata: { action: "reset_personalization" },
      });
      setResetOpen(false);
      setState("loading");
      setAttempt((value) => value + 1);
    } catch {
      setResetOpen(false);
      setUncertain({ kind: "reset" });
    } finally {
      setPending(null);
    }
  }

  if (state === "loading") {
    return <StatusNotice announce="polite">{t("lens.loading")}</StatusNotice>;
  }

  if (state === "signed-out") {
    return (
      <ErrorState
        title={t("lens.signInTitle")}
        description={t("lens.signInDescription")}
        action={
          <ActionLink tone="primary" href={href("/login")}>
            {t("lens.signIn")}
          </ActionLink>
        }
      />
    );
  }

  if (state === "error" || !data) {
    return (
      <ErrorState
        title={t("lens.loadErrorTitle")}
        description={t("lens.loadErrorDescription")}
        action={
          <ActionButton
            type="button"
            tone="secondary"
            data-tv-focusable="true"
            data-tv-focus-id="lens-retry"
            onClick={refresh}
          >
            {t("lens.retry")}
          </ActionButton>
        }
      />
    );
  }

  const resetPending = pending?.kind === "reset";
  const blocked = Boolean(pending || uncertain);

  return (
    <section className={styles.panel} aria-label={t("lens.title")}>
      <div className={styles.toolbar}>
        <div>
          <DataBadge tone={data.mode === "HEURISTIC_V1" ? "info" : "neutral"}>
            {data.mode === "HEURISTIC_V1" ? t("lens.personalized") : t("lens.general")}
          </DataBadge>
          <p>{t("lens.explanation")}</p>
        </div>
        <ActionButton
          type="button"
          tone="secondary"
          data-tv-focusable="true"
          data-tv-focus-id="lens-reset"
          disabled={blocked}
          onClick={() => setResetOpen(true)}
        >
          {t("lens.reset")}
        </ActionButton>
      </div>

      {uncertain ? (
        <div className={styles.recovery}>
          <StatusNotice tone="warning" announce="polite">
            {t(
              uncertain.kind === "reset"
                ? "lens.resetUncertain"
                : "lens.notInterestedUncertain",
            )}
          </StatusNotice>
          <ActionButton
            type="button"
            tone="secondary"
            data-tv-focusable="true"
            data-tv-focus-id="lens-refresh"
            onClick={refresh}
          >
            {t("lens.refresh")}
          </ActionButton>
        </div>
      ) : null}

      {data.items.length === 0 ? (
        <EmptyState title={t("lens.emptyTitle")} description={t("lens.emptyDescription")} />
      ) : (
        <div className={styles.grid}>
          {data.items.map((item) => {
            const itemPending =
              pending?.kind === "not-interested" && pending.videoId === item.id;
            const artwork = item.artworkObjectKey ? mediaAssetUrl(item.artworkObjectKey) : null;
            return (
              <article className={styles.card} key={item.id}>
                <div className={styles.artwork}>
                  <span aria-hidden="true" className={styles.artworkFallback} />
                  {artwork ? <MediaArtwork src={artwork} sizes="(max-width: 640px) 100vw, 22rem" /> : null}
                </div>
                <div className={styles.cardBody}>
                  <DataBadge>{t(lensReasonKey(item.reason.code))}</DataBadge>
                  <h2 dir="auto">{item.title}</h2>
                  <ActionLink
                    tone="quiet"
                    href={href(`/c/${item.channelHandle}`)}
                    data-tv-focusable="true"
                    data-tv-focus-id={`lens-channel-${item.channelId}`}
                  >
                    {item.channelName}
                  </ActionLink>
                  <div className={styles.actions}>
                    <ActionLink
                      tone="primary"
                      href={href(`/watch/${item.slug}`)}
                      data-tv-focusable="true"
                      data-tv-focus-id={`lens-watch-${item.id}`}
                      onClick={() =>
                        trackAnalyticsEvent("RECOMMENDATION_CLICK", {
                          profileId: data.profileId,
                          videoId: item.id,
                          channelId: item.channelId,
                          metadata: { reason: item.reason.code },
                        })
                      }
                    >
                      {t("lens.watch")}
                    </ActionLink>
                    <ActionButton
                      type="button"
                      tone="secondary"
                      pending={itemPending}
                      data-tv-focusable="true"
                      data-tv-focus-id={`lens-not-interested-${item.id}`}
                      disabled={blocked}
                      onClick={() => void notInterested(item)}
                    >
                      {itemPending ? t("lens.marking") : t("lens.notInterested")}
                    </ActionButton>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmationDialog
        open={resetOpen}
        title={t("lens.resetTitle")}
        description={t("lens.resetDescription")}
        confirmLabel={resetPending ? t("lens.resetting") : t("lens.resetConfirm")}
        cancelLabel={t("lens.cancel")}
        direction={direction}
        busy={resetPending}
        onConfirm={() => void resetPersonalization()}
        onCancel={() => setResetOpen(false)}
      />
    </section>
  );
}
