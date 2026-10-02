"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { LiveAyinPlayer } from "@/components/player/live-ayin-player";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  PageHeader,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { useI18n } from "@/components/i18n/i18n-provider";
import { translateLiveViewer } from "@/lib/i18n/live-viewer";
import {
  liveStatusKey,
  liveWaitingKey,
  parseLiveChatMessage,
  parseLiveChatPage,
  parseLiveViewerStream,
  terminalLiveStatus,
  type LiveChatMessage,
  type LiveViewerStatus,
  type LiveViewerStream,
} from "@/lib/live-viewer";

import styles from "./live-watch.module.css";

type StreamLoadState = "loading" | "ready" | "refreshing" | "error" | "unavailable";
type ChatLoadState = "idle" | "loading" | "ready" | "error";
type ChatWriteState = "idle" | "sending" | "rejected" | "uncertain" | "signin";

const STREAM_REFRESH_MS = 4_000;
const STREAM_REFRESH_FAILURE_DELAYS_MS = [2_000, 4_000, 8_000, 15_000] as const;

function statusTone(status: LiveViewerStatus) {
  if (status === "LIVE") return "success" as const;
  if (status === "FAILED") return "danger" as const;
  if (status === "CANCELLED" || status === "ENDED") return "warning" as const;
  return "info" as const;
}

function canRenderPlayer(stream: LiveViewerStream) {
  return (
    Boolean(stream.playbackUrl) &&
    (stream.status === "LIVE" ||
      stream.status === "ENDED" ||
      stream.status === "CANCELLED" ||
      stream.status === "FAILED")
  );
}

export function LiveWatchClient({ slug }: { slug: string }) {
  const { locale, href, formatDate } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateLiveViewer>[1], values?: Parameters<typeof translateLiveViewer>[2]) =>
      translateLiveViewer(locale, key, values),
    [locale],
  );

  const [stream, setStream] = useState<LiveViewerStream | null>(null);
  const [streamState, setStreamState] = useState<StreamLoadState>("loading");
  const [streamRefreshGeneration, setStreamRefreshGeneration] = useState(0);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [chatState, setChatState] = useState<ChatLoadState>("idle");
  const [chatWriteState, setChatWriteState] = useState<ChatWriteState>("idle");
  const [body, setBody] = useState("");

  const pageViewReportedRef = useRef<string | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const chatLoadedRef = useRef<string | null>(null);
  const chatLoadingForRef = useRef<string | null>(null);
  const chatRequestGenerationRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);

  const loadChat = useCallback(
    async (streamId: string, force = false) => {
      if (
        !force &&
        (chatLoadedRef.current === streamId || chatLoadingForRef.current === streamId)
      ) {
        return;
      }

      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;
      const generation = chatRequestGenerationRef.current + 1;
      chatRequestGenerationRef.current = generation;
      chatLoadingForRef.current = streamId;
      if (force) chatLoadedRef.current = null;
      setChatState("loading");

      try {
        const response = await fetch(`${apiBaseUrl}/live/${encodeURIComponent(slug)}/chat`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("LIVE_CHAT_READ_FAILED");
        const chat = parseLiveChatPage(await response.json());
        if (
          controller.signal.aborted ||
          chatRequestGenerationRef.current !== generation ||
          activeStreamIdRef.current !== streamId
        ) {
          return;
        }
        chatLoadedRef.current = streamId;
        setMessages(chat.messages);
        setChatState("ready");
        setChatWriteState((current) => (current === "uncertain" ? "idle" : current));
      } catch {
        if (
          !controller.signal.aborted &&
          chatRequestGenerationRef.current === generation &&
          activeStreamIdRef.current === streamId
        ) {
          setChatState("error");
        }
      } finally {
        if (
          chatRequestGenerationRef.current === generation &&
          chatLoadingForRef.current === streamId
        ) {
          chatLoadingForRef.current = null;
        }
      }
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

    const invalidateChat = () => {
      chatAbortRef.current?.abort();
      chatRequestGenerationRef.current += 1;
      chatLoadingForRef.current = null;
      chatLoadedRef.current = null;
      activeStreamIdRef.current = null;
      setMessages([]);
      setChatState("idle");
      setChatWriteState("idle");
    };

    const refresh = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/live/${encodeURIComponent(slug)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 404) {
            invalidateChat();
            setStream(null);
            setStreamState("unavailable");
            return;
          }
          throw new Error("LIVE_STATUS_REFRESH_FAILED");
        }

        const next = parseLiveViewerStream(await response.json());
        if (stopped || controller.signal.aborted) return;

        failureAttempt = 0;
        if (activeStreamIdRef.current !== next.id) {
          chatAbortRef.current?.abort();
          chatRequestGenerationRef.current += 1;
          chatLoadedRef.current = null;
          chatLoadingForRef.current = null;
          activeStreamIdRef.current = next.id;
          setMessages([]);
          setChatState("idle");
          setChatWriteState("idle");
        }

        setStream(next);
        setStreamState("ready");

        if (pageViewReportedRef.current !== next.id) {
          pageViewReportedRef.current = next.id;
          trackAnalyticsEvent("LIVE_PAGE_VIEW", {
            channelId: next.channel.id,
            metadata: { liveStreamId: next.id },
          });
        }

        void loadChat(next.id);
        if (!terminalLiveStatus(next.status)) schedule(STREAM_REFRESH_MS);
      } catch {
        if (controller.signal.aborted || stopped) return;
        const delay = STREAM_REFRESH_FAILURE_DELAYS_MS[failureAttempt] ?? null;
        if (delay === null) {
          setStreamState("error");
          return;
        }
        failureAttempt += 1;
        setStreamState("refreshing");
        schedule(delay);
      }
    };

    void refresh();
    return () => {
      stopped = true;
      controller.abort();
      chatAbortRef.current?.abort();
      chatRequestGenerationRef.current += 1;
      chatLoadingForRef.current = null;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadChat, slug, streamRefreshGeneration]);

  function refreshStream() {
    setStreamState(stream ? "refreshing" : "loading");
    setStreamRefreshGeneration((value) => value + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft = body.trim();
    if (
      !draft ||
      !stream ||
      chatWriteState === "sending" ||
      chatWriteState === "uncertain"
    ) {
      return;
    }

    setChatWriteState("sending");
    try {
      const response = await fetch(`${apiBaseUrl}/live/${encodeURIComponent(slug)}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });

      if (response.status === 401) {
        setChatWriteState("signin");
        return;
      }
      if (!response.ok) {
        setChatWriteState(response.status >= 500 ? "uncertain" : "rejected");
        return;
      }

      const message = parseLiveChatMessage(await response.json());
      setMessages((current) =>
        current.some((item) => item.id === message.id) ? current : [...current, message],
      );
      setBody("");
      setChatWriteState("idle");
      trackAnalyticsEvent("LIVE_CHAT_MESSAGE", {
        channelId: stream.channel.id,
        metadata: { liveStreamId: stream.id },
      });
    } catch {
      setChatWriteState("uncertain");
    }
  }

  const retryChat = () => {
    if (!stream) return;
    void loadChat(stream.id, true);
  };

  const header = stream ? (
    <PageHeader
      eyebrow={t("live.eyebrow")}
      title={stream.title}
      {...(stream.description ? { description: stream.description } : {})}
      actions={
        <ActionLink
          href={href(`/c/${encodeURIComponent(stream.channel.handle)}`)}
          tone="secondary"
          data-tv-focusable="true"
          data-tv-focus-id="live-channel"
        >
          {t("live.viewChannel")}
        </ActionLink>
      }
    >
      <div className={styles.headerMeta}>
        <DataBadge tone={statusTone(stream.status)}>{t(liveStatusKey(stream.status))}</DataBadge>
        <span dir="auto">
          {t("live.channel")}: {stream.channel.name} · <bdi dir="ltr">@{stream.channel.handle}</bdi>
        </span>
      </div>
    </PageHeader>
  ) : (
    <PageHeader
      eyebrow={t("live.eyebrow")}
      title={t("live.metaTitle")}
      description={t("live.metaDescription")}
    />
  );

  const renderStreamNotice = () => {
    if (streamState === "loading") {
      return <StatusNotice announce="polite">{t("live.loading")}</StatusNotice>;
    }
    if (streamState === "refreshing") {
      return <StatusNotice announce="polite">{t("live.refreshing")}</StatusNotice>;
    }
    if (streamState === "unavailable") {
      return (
        <EmptyState
          title={t("live.unavailableTitle")}
          description={t("live.unavailableDescription")}
          action={
            <ActionButton
              type="button"
              tone="secondary"
              data-tv-focusable="true"
              data-tv-focus-id="live-retry-unavailable"
              onClick={refreshStream}
            >
              {t("live.retry")}
            </ActionButton>
          }
        />
      );
    }
    if (streamState === "error") {
      return (
        <ErrorState
          title={t("live.unavailableTitle")}
          description={t("live.refreshError")}
          action={
            <ActionButton
              type="button"
              tone="secondary"
              data-tv-focusable="true"
              data-tv-focus-id="live-retry"
              onClick={refreshStream}
            >
              {t("live.retry")}
            </ActionButton>
          }
        />
      );
    }
    return null;
  };

  const chatActive = Boolean(stream?.chatEnabled && stream.status === "LIVE");

  return (
    <main className={styles.page}>
      <section className={styles.header}>{header}</section>

      {streamState !== "ready" ? <div className={styles.notice}>{renderStreamNotice()}</div> : null}

      {stream ? (
        <>
          <section className={styles.playerRegion} aria-label={stream.title}>
            {canRenderPlayer(stream) && stream.playbackUrl ? (
              <LiveAyinPlayer
                key={stream.id}
                autoPlay
                captions={stream.captions}
                channelId={stream.channel.id}
                dvrWindowSeconds={stream.dvrWindowSeconds}
                muted
                playbackUrl={stream.playbackUrl}
                status={stream.status}
                streamId={stream.id}
                title={stream.title}
              />
            ) : (
              <StatusNotice
                tone={stream.status === "FAILED" ? "danger" : "info"}
                announce="polite"
                title={t(liveStatusKey(stream.status))}
              >
                <p>{t(liveWaitingKey(stream.status))}</p>
                {stream.scheduledStartAt ? (
                  <p>
                    {t("live.starts", {
                      date: formatDate(stream.scheduledStartAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })}
                  </p>
                ) : null}
                {!terminalLiveStatus(stream.status) ? (
                  <ActionButton
                    type="button"
                    tone="secondary"
                    data-tv-focusable="true"
                    data-tv-focus-id="live-check-now"
                    onClick={refreshStream}
                  >
                    {t("live.checkNow")}
                  </ActionButton>
                ) : null}
              </StatusNotice>
            )}
          </section>

          <section className={styles.chat} aria-labelledby="live-chat-title">
            <div className={styles.chatHeading}>
              <div>
                <h2 id="live-chat-title">{t("live.chatTitle")}</h2>
                <p>{t("live.chatDescription")}</p>
              </div>
              {(chatState === "error" || chatWriteState === "uncertain") && (
                <ActionButton
                  type="button"
                  tone="secondary"
                  data-tv-focusable="true"
                  data-tv-focus-id="live-chat-refresh"
                  onClick={retryChat}
                >
                  {chatState === "error" ? t("live.chatRetry") : t("live.chatRefresh")}
                </ActionButton>
              )}
            </div>

            {chatState === "loading" ? (
              <StatusNotice announce="polite">{t("live.chatLoading")}</StatusNotice>
            ) : null}
            {chatState === "error" ? (
              <StatusNotice tone="warning" announce="polite">
                {t("live.chatError")}
              </StatusNotice>
            ) : null}

            {chatState === "ready" ? (
              messages.length > 0 ? (
                <ol className={styles.messages} aria-label={t("live.chatTitle")}>
                  {messages.map((message) => (
                    <li key={message.id}>
                      <p dir="auto">{message.body}</p>
                      <time dateTime={message.createdAt}>
                        {formatDate(message.createdAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.empty}>{t("live.chatEmpty")}</p>
              )
            ) : null}

            {chatWriteState === "uncertain" ? (
              <StatusNotice tone="warning" announce="polite">
                {t("live.chatUncertain")}
              </StatusNotice>
            ) : null}
            {chatWriteState === "rejected" ? (
              <StatusNotice tone="danger" announce="polite">
                {t("live.chatRejected")}
              </StatusNotice>
            ) : null}
            {chatWriteState === "signin" ? (
              <StatusNotice tone="info" announce="polite" title={t("live.chatSignIn")}>
                <p>{t("live.chatSignInDescription")}</p>
                <ActionLink href={href("/login")} tone="secondary">
                  {t("live.chatSignIn")}
                </ActionLink>
              </StatusNotice>
            ) : null}

            {chatActive ? (
              <form className={styles.chatForm} onSubmit={submit} aria-label={t("live.chatTitle")}>
                <TextField
                  id="live-chat-message"
                  label={t("live.chatMessage")}
                  placeholder={t("live.chatPlaceholder")}
                  value={body}
                  maxLength={500}
                  disabled={chatWriteState === "sending" || chatWriteState === "uncertain"}
                  data-tv-focusable="true"
                  data-tv-focus-id="live-chat-message"
                  onChange={(event) => {
                    setBody(event.target.value);
                    if (chatWriteState === "rejected") setChatWriteState("idle");
                  }}
                />
                <ActionButton
                  type="submit"
                  pending={chatWriteState === "sending"}
                  disabled={
                    !body.trim() ||
                    chatWriteState === "sending" ||
                    chatWriteState === "uncertain"
                  }
                  data-tv-focusable="true"
                  data-tv-focus-id="live-chat-send"
                >
                  {chatWriteState === "sending" ? t("live.chatSending") : t("live.chatSend")}
                </ActionButton>
              </form>
            ) : (
              <StatusNotice tone="neutral">{t("live.chatInactive")}</StatusNotice>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
