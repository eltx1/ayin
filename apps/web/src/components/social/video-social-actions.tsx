"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, StatusNotice } from "@/components/ui/design-system";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";
import { translateSocialAction } from "@/lib/i18n/social-actions";
import {
  parseSavedMutation,
  parseVideoSocialState,
  type VideoSocialState,
} from "@/lib/social-action-contracts";

import feedbackStyles from "./social-action-feedback.module.css";

type Mode = "loading" | "ready" | "signedOut" | "error" | "uncertain";

interface Snapshot {
  videoId: string;
  mode: Mode;
  value: VideoSocialState;
}

const emptyState: VideoSocialState = {
  reaction: null,
  likeCount: 0,
  watchLater: false,
  myList: false,
};

export function VideoSocialActions({
  videoId,
  className,
}: {
  videoId: string;
  className?: string | undefined;
}) {
  const { formatNumber, href, locale, t: coreT } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateSocialAction>[1]) => translateSocialAction(locale, key),
    [locale],
  );
  const router = useRouter();
  const currentVideoId = useRef(videoId);
  currentVideoId.current = videoId;
  const [snapshot, setSnapshot] = useState<Snapshot>({
    videoId,
    mode: "loading",
    value: emptyState,
  });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<{ videoId: string; action: string } | null>(null);

  const active =
    snapshot.videoId === videoId
      ? snapshot
      : { videoId, mode: "loading" as const, value: emptyState };
  const busy = pending?.videoId === videoId;

  useEffect(() => {
    const controller = new AbortController();
    const requestedVideoId = videoId;
    void fetch(`${apiBaseUrl}/social/videos/${requestedVideoId}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          return { mode: "signedOut" as const, value: emptyState };
        }
        if (!response.ok) throw new Error("SOCIAL_STATE_UNAVAILABLE");
        return { mode: "ready" as const, value: parseVideoSocialState(await response.json()) };
      })
      .then((result) => {
        if (!result || controller.signal.aborted || currentVideoId.current !== requestedVideoId) {
          return;
        }
        setSnapshot({ videoId: requestedVideoId, ...result });
      })
      .catch(() => {
        if (!controller.signal.aborted && currentVideoId.current === requestedVideoId) {
          setSnapshot({ videoId: requestedVideoId, mode: "error", value: emptyState });
        }
      });
    return () => controller.abort();
  }, [attempt, videoId]);

  function refresh() {
    if (busy) return;
    setSnapshot((current) =>
      current.videoId === videoId ? { ...current, mode: "loading" } : current,
    );
    setAttempt((value) => value + 1);
  }

  function requireReady() {
    if (active.mode === "signedOut") {
      router.push(href("/login"));
      return false;
    }
    if (active.mode === "error" || active.mode === "uncertain") {
      refresh();
      return false;
    }
    return active.mode === "ready" && !busy;
  }

  async function request(
    action: string,
    path: string,
    method: "PUT" | "DELETE",
    body?: object,
  ) {
    if (!requireReady()) return null;
    const requestedVideoId = videoId;
    setPending({ videoId: requestedVideoId, action });
    try {
      const response = await fetch(`${apiBaseUrl}/social/videos/${requestedVideoId}/${path}`, {
        method,
        credentials: "include",
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401) {
        if (currentVideoId.current === requestedVideoId) {
          setSnapshot((current) => ({ ...current, mode: "signedOut" }));
          router.push(href("/login"));
        }
        return null;
      }
      if (!response.ok) throw new Error("SOCIAL_MUTATION_UNCONFIRMED");
      return { response, requestedVideoId };
    } catch {
      if (currentVideoId.current === requestedVideoId) {
        setSnapshot((current) =>
          current.videoId === requestedVideoId ? { ...current, mode: "uncertain" } : current,
        );
      }
      return null;
    } finally {
      setPending((current) =>
        current?.videoId === requestedVideoId && current.action === action ? null : current,
      );
    }
  }

  async function react(type: "LIKE" | "DISLIKE") {
    const removing = active.value.reaction === type;
    const result = await request(
      `reaction-${type}`,
      "reaction",
      removing ? "DELETE" : "PUT",
      removing ? undefined : { type },
    );
    if (!result) return;
    try {
      const value = parseVideoSocialState(await result.response.json());
      if (currentVideoId.current !== result.requestedVideoId) return;
      setSnapshot({ videoId: result.requestedVideoId, mode: "ready", value });
      if (type === "LIKE" && !removing) trackAnalyticsEvent("LIKE", { videoId });
    } catch {
      if (currentVideoId.current === result.requestedVideoId) {
        setSnapshot((current) => ({ ...current, mode: "uncertain" }));
      }
    }
  }

  async function save(list: "watch-later" | "my-list", current: boolean) {
    const result = await request(list, list, current ? "DELETE" : "PUT", current ? undefined : {});
    if (!result) return;
    try {
      parseSavedMutation(await result.response.json(), list, !current);
      if (currentVideoId.current !== result.requestedVideoId) return;
      setSnapshot((currentState) => ({
        videoId: result.requestedVideoId,
        mode: "ready",
        value: {
          ...currentState.value,
          [list === "watch-later" ? "watchLater" : "myList"]: !current,
        },
      }));
    } catch {
      if (currentVideoId.current === result.requestedVideoId) {
        setSnapshot((currentState) => ({ ...currentState, mode: "uncertain" }));
      }
    }
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else await navigator.clipboard.writeText(url);
      trackAnalyticsEvent("SHARE", { videoId });
    } catch {
      // Cancellation is a normal share-sheet outcome and must not affect playback or server state.
    }
  }

  const actionDisabled =
    busy || active.mode === "loading" || active.mode === "error" || active.mode === "uncertain";
  const feedback =
    active.mode === "loading"
      ? t("social.videoLoading")
      : active.mode === "error"
        ? t("social.videoUnavailable")
        : active.mode === "uncertain"
          ? t("social.videoUncertain")
          : null;

  return (
    <div className={className} aria-label={coreT("watch.actions")}>
      <button
        aria-pressed={active.value.reaction === "LIKE"}
        data-tv-focusable="true"
        data-tv-focus-id={`video-${videoId}-like`}
        disabled={actionDisabled}
        onClick={() => void react("LIKE")}
        type="button"
      >
        {coreT("watch.like")} · {formatNumber(active.value.likeCount)}
      </button>
      <button
        aria-label={coreT("watch.notForMe")}
        aria-pressed={active.value.reaction === "DISLIKE"}
        data-tv-focusable="true"
        data-tv-focus-id={`video-${videoId}-not-for-me`}
        disabled={actionDisabled}
        onClick={() => void react("DISLIKE")}
        type="button"
      >
        {coreT("watch.notForMe")}
      </button>
      <button
        aria-pressed={active.value.watchLater}
        data-tv-focusable="true"
        data-tv-focus-id={`video-${videoId}-watch-later`}
        disabled={actionDisabled}
        onClick={() => void save("watch-later", active.value.watchLater)}
        type="button"
      >
        {active.value.watchLater ? coreT("watch.inWatchLater") : coreT("watch.watchLater")}
      </button>
      <button
        aria-pressed={active.value.myList}
        data-tv-focusable="true"
        data-tv-focus-id={`video-${videoId}-my-list`}
        disabled={actionDisabled}
        onClick={() => void save("my-list", active.value.myList)}
        type="button"
      >
        {active.value.myList ? coreT("watch.inMyList") : coreT("watch.myList")}
      </button>
      <button
        data-tv-focusable="true"
        data-tv-focus-id={`video-${videoId}-share`}
        disabled={busy}
        onClick={() => void share()}
        type="button"
      >
        {coreT("watch.share")}
      </button>

      {feedback ? (
        <StatusNotice
          announce={active.mode === "loading" ? "polite" : "assertive"}
          className={feedbackStyles.feedback}
          tone={
            active.mode === "uncertain" ? "warning" : active.mode === "error" ? "danger" : "info"
          }
        >
          {feedback}
          {active.mode === "error" || active.mode === "uncertain" ? (
            <div className={feedbackStyles.feedbackActions}>
              <ActionButton
                type="button"
                tone="secondary"
                data-tv-focusable="true"
                data-tv-focus-id={`video-${videoId}-social-refresh`}
                onClick={refresh}
              >
                {active.mode === "uncertain" ? t("social.refreshVideo") : t("social.retryVideo")}
              </ActionButton>
            </div>
          ) : null}
        </StatusNotice>
      ) : null}
    </div>
  );
}
