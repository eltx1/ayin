"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/components/i18n/i18n-provider";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";

interface VideoState {
  reaction: "LIKE" | "DISLIKE" | null;
  likeCount: number;
  watchLater: boolean;
  myList: boolean;
}

export function VideoSocialActions({
  videoId,
  className,
}: {
  videoId: string;
  className?: string | undefined;
}) {
  const { formatNumber, href, t } = useI18n();
  const [state, setState] = useState<VideoState>({
    reaction: null,
    likeCount: 0,
    watchLater: false,
    myList: false,
  });
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/social/videos/${videoId}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) setState((await response.json()) as VideoState);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [router, videoId]);

  async function request(path: string, method: "PUT" | "DELETE", body?: object) {
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/social/videos/${videoId}/${path}`, {
        method,
        credentials: "include",
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401) {
        router.push(href("/login"));
        return null;
      }
      return response;
    } finally {
      setBusy(false);
    }
  }

  async function react(type: "LIKE" | "DISLIKE") {
    const removing = state.reaction === type;
    const response = await request(
      "reaction",
      removing ? "DELETE" : "PUT",
      removing ? undefined : { type },
    );
    if (response?.ok) {
      setState((await response.json()) as VideoState);
      if (type === "LIKE" && !removing) trackAnalyticsEvent("LIKE", { videoId });
    }
  }

  async function save(list: "watch-later" | "my-list", current: boolean) {
    const response = await request(list, current ? "DELETE" : "PUT", current ? undefined : {});
    if (response?.ok) {
      setState((value) => ({
        ...value,
        [list === "watch-later" ? "watchLater" : "myList"]: !current,
      }));
    }
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else await navigator.clipboard.writeText(url);
      trackAnalyticsEvent("SHARE", { videoId });
    } catch {
      // User cancellation or unavailable clipboard should not affect playback.
    }
  }

  return (
    <div className={className} aria-label={t("watch.actions")}>
      <button
        aria-pressed={state.reaction === "LIKE"}
        disabled={busy}
        onClick={() => void react("LIKE")}
        type="button"
      >
        {t("watch.like")} · {formatNumber(state.likeCount)}
      </button>
      <button
        aria-label={t("watch.notForMe")}
        aria-pressed={state.reaction === "DISLIKE"}
        disabled={busy}
        onClick={() => void react("DISLIKE")}
        type="button"
      >
        {t("watch.notForMe")}
      </button>
      <button
        aria-pressed={state.watchLater}
        disabled={busy}
        onClick={() => void save("watch-later", state.watchLater)}
        type="button"
      >
        {state.watchLater ? t("watch.inWatchLater") : t("watch.watchLater")}
      </button>
      <button
        aria-pressed={state.myList}
        disabled={busy}
        onClick={() => void save("my-list", state.myList)}
        type="button"
      >
        {state.myList ? t("watch.inMyList") : t("watch.myList")}
      </button>
      <button disabled={busy} onClick={() => void share()} type="button">
        {t("watch.share")}
      </button>
    </div>
  );
}
