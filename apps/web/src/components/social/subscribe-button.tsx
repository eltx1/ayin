"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/components/i18n/i18n-provider";
import { StatusNotice } from "@/components/ui/design-system";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";
import { translateSocialAction } from "@/lib/i18n/social-actions";
import { parseChannelSocialState, type ChannelSocialState } from "@/lib/social-action-contracts";

import feedbackStyles from "./social-action-feedback.module.css";

type Mode = "loading" | "ready" | "signedOut" | "error" | "uncertain";

interface Snapshot {
  channelId: string;
  mode: Mode;
  value: ChannelSocialState;
}

export function SubscribeButton({
  channelId,
  initialCount,
  className,
}: {
  channelId: string;
  initialCount: number;
  className?: string | undefined;
}) {
  const router = useRouter();
  const { formatNumber, href, locale } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateSocialAction>[1]) => translateSocialAction(locale, key),
    [locale],
  );
  const currentChannelId = useRef(channelId);
  currentChannelId.current = channelId;
  const [snapshot, setSnapshot] = useState<Snapshot>({
    channelId,
    mode: "loading",
    value: { subscribed: false, subscriberCount: initialCount },
  });
  const [attempt, setAttempt] = useState(0);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);

  const active =
    snapshot.channelId === channelId
      ? snapshot
      : {
          channelId,
          mode: "loading" as const,
          value: { subscribed: false, subscriberCount: initialCount },
        };
  const busy = pendingChannelId === channelId;

  useEffect(() => {
    const controller = new AbortController();
    const requestedChannelId = channelId;
    void fetch(`${apiBaseUrl}/social/channels/${requestedChannelId}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          return {
            mode: "signedOut" as const,
            value: { subscribed: false, subscriberCount: initialCount },
          };
        }
        if (!response.ok) throw new Error("SOCIAL_STATE_UNAVAILABLE");
        return {
          mode: "ready" as const,
          value: parseChannelSocialState(await response.json()),
        };
      })
      .then((result) => {
        if (
          !result ||
          controller.signal.aborted ||
          currentChannelId.current !== requestedChannelId
        ) {
          return;
        }
        setSnapshot({ channelId: requestedChannelId, ...result });
      })
      .catch(() => {
        if (!controller.signal.aborted && currentChannelId.current === requestedChannelId) {
          setSnapshot((current) => ({
            channelId: requestedChannelId,
            mode: "error",
            value:
              current.channelId === requestedChannelId
                ? current.value
                : { subscribed: false, subscriberCount: initialCount },
          }));
        }
      });
    return () => controller.abort();
  }, [attempt, channelId, initialCount]);

  function refresh() {
    if (busy) return;
    setSnapshot((current) =>
      current.channelId === channelId ? { ...current, mode: "loading" } : current,
    );
    setAttempt((value) => value + 1);
  }

  async function toggle() {
    if (active.mode === "signedOut") {
      router.push(href("/login"));
      return;
    }
    if (active.mode === "error" || active.mode === "uncertain") {
      refresh();
      return;
    }
    if (active.mode !== "ready" || busy) return;

    const requestedChannelId = channelId;
    const wasSubscribed = active.value.subscribed;
    setPendingChannelId(requestedChannelId);
    try {
      const response = await fetch(
        `${apiBaseUrl}/social/channels/${requestedChannelId}/subscription`,
        {
          method: wasSubscribed ? "DELETE" : "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          ...(wasSubscribed ? {} : { body: "{}" }),
        },
      );
      if (response.status === 401) {
        if (currentChannelId.current === requestedChannelId) {
          setSnapshot((current) => ({ ...current, mode: "signedOut" }));
          router.push(href("/login"));
        }
        return;
      }
      if (!response.ok) throw new Error("SOCIAL_MUTATION_UNCONFIRMED");
      const value = parseChannelSocialState(await response.json());
      if (currentChannelId.current !== requestedChannelId) return;
      setSnapshot({ channelId: requestedChannelId, mode: "ready", value });
      if (!wasSubscribed) trackAnalyticsEvent("SUBSCRIBE", { channelId: requestedChannelId });
    } catch {
      if (currentChannelId.current === requestedChannelId) {
        setSnapshot((current) =>
          current.channelId === requestedChannelId ? { ...current, mode: "uncertain" } : current,
        );
      }
    } finally {
      setPendingChannelId((current) => (current === requestedChannelId ? null : current));
    }
  }

  const label =
    active.mode === "loading"
      ? t("social.subscriptionLoading")
      : active.mode === "error"
        ? t("social.retrySubscription")
        : active.mode === "uncertain"
          ? t("social.refreshSubscription")
          : active.value.subscribed
            ? t("social.subscribed")
            : t("social.subscribe");

  const feedback =
    active.mode === "error"
      ? t("social.subscriptionUnavailable")
      : active.mode === "uncertain"
        ? t("social.subscriptionUncertain")
        : null;

  return (
    <div className={feedbackStyles.subscribeControl}>
      <button
        className={className}
        data-tv-focusable="true"
        data-tv-focus-id={`channel-${channelId}-subscription`}
        disabled={busy || active.mode === "loading"}
        onClick={() => void toggle()}
        type="button"
      >
        {label} · {formatNumber(active.value.subscriberCount)}
      </button>
      {feedback ? (
        <StatusNotice
          announce="polite"
          className={feedbackStyles.subscribeFeedback}
          tone={active.mode === "uncertain" ? "warning" : "danger"}
        >
          {feedback}
        </StatusNotice>
      ) : null}
    </div>
  );
}
