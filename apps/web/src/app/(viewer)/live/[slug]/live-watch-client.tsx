"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { LiveAyinPlayer, type LivePlayerStreamStatus } from "@/components/player/live-ayin-player";
import { apiBaseUrl } from "@/lib/api";
import { trackAnalyticsEvent } from "@/lib/analytics";
import type { AyinCaptionTrack } from "@/lib/ayin-player";

type Stream = {
  id: string;
  title: string;
  description: string | null;
  status: LivePlayerStreamStatus;
  playbackUrl: string | null;
  scheduledStartAt: string | null;
  chatEnabled: boolean;
  adBreakHook: "IMA_CLIENT_BREAK" | null;
  captions?: AyinCaptionTrack[];
  dvrWindowSeconds?: number | null;
  channel: { id: string; handle: string; name: string };
};

type ChatMessage = { id: string; body: string; createdAt: string };

const STREAM_REFRESH_MS = 4_000;
const STREAM_REFRESH_FAILURE_DELAYS_MS = [2_000, 4_000, 8_000, 15_000] as const;

function terminalStatus(status: LivePlayerStreamStatus): boolean {
  return status === "ENDED" || status === "CANCELLED" || status === "FAILED";
}

function waitingCopy(stream: Stream): string {
  if (stream.status === "SCHEDULED")
    return "This live stream is scheduled and has not started yet.";
  if (stream.status === "READY") return "The encoder is ready. Waiting for playable live output…";
  if (stream.status === "DRAFT") return "This live stream has not started yet.";
  return "Waiting for live output…";
}

export function LiveWatchClient({ slug }: { slug: string }) {
  const [stream, setStream] = useState<Stream | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("Loading live session…");
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const pageViewReportedRef = useRef<string | null>(null);
  const chatLoadedRef = useRef<string | null>(null);

  const loadChat = useCallback(
    async (streamId: string) => {
      if (chatLoadedRef.current === streamId) return;
      const response = await fetch(`${apiBaseUrl}/live/${encodeURIComponent(slug)}/chat`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const chat = (await response.json()) as { messages: ChatMessage[] };
      chatLoadedRef.current = streamId;
      setMessages(chat.messages);
    },
    [slug],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | null = null;
    let failureAttempt = 0;
    let stopped = false;

    const schedule = (delayMs: number) => {
      if (stopped || controller.signal.aborted) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), delayMs);
    };

    const refresh = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/live/${encodeURIComponent(slug)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 404) {
            setStatus("This live session is unavailable.");
            return;
          }
          throw new Error("Live status refresh failed.");
        }

        const next = (await response.json()) as Stream;
        if (stopped) return;
        failureAttempt = 0;
        setStream(next);
        setStatus("");
        if (pageViewReportedRef.current !== next.id) {
          pageViewReportedRef.current = next.id;
          trackAnalyticsEvent("LIVE_PAGE_VIEW", {
            channelId: next.channel.id,
            metadata: { liveStreamId: next.id },
          });
        }
        void loadChat(next.id);
        if (!terminalStatus(next.status)) schedule(STREAM_REFRESH_MS);
      } catch {
        if (controller.signal.aborted || stopped) return;
        const delay = STREAM_REFRESH_FAILURE_DELAYS_MS[failureAttempt] ?? null;
        if (delay === null) {
          setStatus("Live status could not be refreshed. Check your connection and try again.");
          return;
        }
        failureAttempt += 1;
        setStatus("Refreshing live status…");
        schedule(delay);
      }
    };

    void refresh();
    return () => {
      stopped = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadChat, refreshGeneration, slug]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || !stream) return;
    const response = await fetch(`${apiBaseUrl}/live/${encodeURIComponent(slug)}/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) return;
    const message = (await response.json()) as ChatMessage;
    setMessages((current) => [...current, message]);
    setBody("");
    trackAnalyticsEvent("LIVE_CHAT_MESSAGE", {
      channelId: stream.channel.id,
      metadata: { liveStreamId: stream.id },
    });
  }

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "24px" }}>
      {status ? (
        <section aria-live="polite">
          <p>{status}</p>
          {status.includes("try again") ? (
            <button onClick={() => setRefreshGeneration((value) => value + 1)} type="button">
              Try again
            </button>
          ) : null}
        </section>
      ) : null}

      {stream ? (
        <>
          <p>{stream.channel.name}</p>
          <h1>{stream.title}</h1>
          {stream.description ? <p>{stream.description}</p> : null}

          {stream.playbackUrl &&
          (stream.status === "LIVE" ||
            stream.status === "ENDED" ||
            stream.status === "CANCELLED" ||
            stream.status === "FAILED") ? (
            <LiveAyinPlayer
              key={stream.id}
              autoPlay
              captions={stream.captions ?? []}
              channelId={stream.channel.id}
              dvrWindowSeconds={stream.dvrWindowSeconds ?? null}
              muted
              playbackUrl={stream.playbackUrl}
              status={stream.status}
              streamId={stream.id}
              title={stream.title}
            />
          ) : (
            <section aria-live="polite">
              <strong>{stream.status === "SCHEDULED" ? "Scheduled" : stream.status}</strong>
              <p>{waitingCopy(stream)}</p>
              {stream.scheduledStartAt ? (
                <p>Starts {new Date(stream.scheduledStartAt).toLocaleString()}</p>
              ) : null}
              {!terminalStatus(stream.status) ? (
                <button onClick={() => setRefreshGeneration((value) => value + 1)} type="button">
                  Check now
                </button>
              ) : null}
            </section>
          )}

          {stream.adBreakHook ? (
            <button
              type="button"
              onClick={() =>
                trackAnalyticsEvent("LIVE_AD_BREAK_OPPORTUNITY", {
                  channelId: stream.channel.id,
                  metadata: { liveStreamId: stream.id, hook: stream.adBreakHook },
                })
              }
            >
              Register ad-break opportunity
            </button>
          ) : null}

          <section>
            <h2>Live chat</h2>
            {messages.map((message) => (
              <p key={message.id}>{message.body}</p>
            ))}
            {stream.chatEnabled && stream.status === "LIVE" ? (
              <form onSubmit={submit}>
                <label>
                  Message
                  <input
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={500}
                  />
                </label>
                <button type="submit">Send</button>
              </form>
            ) : (
              <p>Chat is not active.</p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
