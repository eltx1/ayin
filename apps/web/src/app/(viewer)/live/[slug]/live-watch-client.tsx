"use client";

import { FormEvent, useEffect, useState } from "react";

import { apiBaseUrl } from "@/lib/api";
import { trackAnalyticsEvent } from "@/lib/analytics";

type Stream = {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "SCHEDULED" | "READY" | "LIVE" | "ENDED" | "CANCELLED" | "FAILED";
  playbackUrl: string | null;
  scheduledStartAt: string | null;
  chatEnabled: boolean;
  adBreakHook: "IMA_CLIENT_BREAK" | null;
  channel: { id: string; handle: string; name: string };
};

type ChatMessage = { id: string; body: string; createdAt: string };

export function LiveWatchClient({ slug }: { slug: string }) {
  const [stream, setStream] = useState<Stream | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("Loading live session…");

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await fetch(`${apiBaseUrl}/live/${encodeURIComponent(slug)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        if (active) setStatus("This live session is unavailable.");
        return;
      }
      const next = (await response.json()) as Stream;
      if (!active) return;
      setStream(next);
      setStatus("");
      trackAnalyticsEvent("LIVE_PAGE_VIEW", {
        channelId: next.channel.id,
        metadata: { liveStreamId: next.id },
      });
      const chatResponse = await fetch(`${apiBaseUrl}/live/${encodeURIComponent(slug)}/chat`, {
        cache: "no-store",
      });
      if (chatResponse.ok && active) {
        const chat = (await chatResponse.json()) as { messages: ChatMessage[] };
        setMessages(chat.messages);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [slug]);

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
      {status ? <p>{status}</p> : null}
      {stream ? (
        <>
          <p>{stream.channel.name}</p>
          <h1>{stream.title}</h1>
          {stream.description ? <p>{stream.description}</p> : null}
          {stream.status === "LIVE" && stream.playbackUrl ? (
            <video
              src={stream.playbackUrl}
              controls
              autoPlay
              muted
              playsInline
              style={{ width: "100%", background: "#000", aspectRatio: "16 / 9" }}
              onPlay={() =>
                trackAnalyticsEvent("LIVE_PLAY_START", {
                  channelId: stream.channel.id,
                  metadata: { liveStreamId: stream.id },
                })
              }
              onEnded={() =>
                trackAnalyticsEvent("LIVE_PLAY_COMPLETE", {
                  channelId: stream.channel.id,
                  metadata: { liveStreamId: stream.id },
                })
              }
            />
          ) : (
            <section aria-live="polite">
              <strong>{stream.status === "SCHEDULED" ? "Scheduled" : stream.status}</strong>
              {stream.scheduledStartAt ? (
                <p>Starts {new Date(stream.scheduledStartAt).toLocaleString()}</p>
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
