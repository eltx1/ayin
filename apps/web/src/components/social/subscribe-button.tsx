"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";

export function SubscribeButton({
  channelId,
  initialCount,
  className,
}: {
  channelId: string;
  initialCount: number;
  className?: string | undefined;
}) {
  const [state, setState] = useState({ subscribed: false, subscriberCount: initialCount });
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/social/channels/${channelId}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        setSignedIn(response.ok);
        if (response.ok) setState((await response.json()) as typeof state);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [channelId, router]);

  async function toggle() {
    if (signedIn === false) {
      router.push("/login");
      return;
    }
    const wasSubscribed = state.subscribed;
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/social/channels/${channelId}/subscription`, {
        method: wasSubscribed ? "DELETE" : "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        ...(wasSubscribed ? {} : { body: "{}" }),
      });
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (response.ok) {
        setState((await response.json()) as typeof state);
        if (!wasSubscribed) trackAnalyticsEvent("SUBSCRIBE", { channelId });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={className}
      data-tv-focusable="true"
      disabled={busy}
      onClick={() => void toggle()}
      type="button"
    >
      {state.subscribed ? "Subscribed" : "Subscribe"} · {state.subscriberCount}
    </button>
  );
}
