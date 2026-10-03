"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  StatusNotice,
  TextAreaField,
} from "@/components/ui/design-system";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";
import { translateViewerComment, type ViewerCommentKey } from "@/lib/i18n/viewer-comments";
import {
  parseViewerCommentAck,
  parseViewerCommentPage,
  type ViewerComment,
} from "@/lib/viewer-comments";
import styles from "./comments.module.css";

type WriteState = "idle" | "sending" | "uncertain" | "rejected" | "signin" | "posted";

export function CommentsPanel(props: { videoId: string; enabled: boolean }) {
  return <CommentThread key={`${props.videoId}:${props.enabled}`} {...props} />;
}

function CommentThread({ videoId, enabled }: { videoId: string; enabled: boolean }) {
  const { locale, href } = useI18n();
  const t = useCallback((key: ViewerCommentKey) => translateViewerComment(locale, key), [locale]);
  const [items, setItems] = useState<ViewerComment[]>([]);
  const [body, setBody] = useState("");
  const [readState, setReadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [writeState, setWriteState] = useState<WriteState>("idle");
  const [serverEnabled, setServerEnabled] = useState(enabled);
  const [cursor, setCursor] = useState<number | null>(null);
  const mounted = useRef(false);
  const reading = useRef(false);
  const sending = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const endpoint = `${apiBaseUrl}/comments/videos/${encodeURIComponent(videoId)}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const load = useCallback(
    async (next: number | null = null) => {
      if (!enabled || reading.current || sending.current) return;
      reading.current = true;
      const controller = new AbortController();
      abort.current = controller;
      setReadState("loading");
      try {
        const response = await fetch(next === null ? endpoint : `${endpoint}?cursor=${next}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("COMMENTS_UNAVAILABLE");
        const data = parseViewerCommentPage(await response.json(), next ?? 0);
        if (!mounted.current || controller.signal.aborted) return;
        setItems((current) =>
          next === null
            ? data.items
            : [
                ...current,
                ...data.items.filter(
                  (item) => !current.some((existing) => existing.id === item.id),
                ),
              ],
        );
        setCursor(data.nextCursor);
        setServerEnabled(data.enabled);
        setReadState("ready");
        // Only an explicit full reload may reconcile an unconfirmed mutation.
        if (next === null)
          setWriteState((current) =>
            current === "uncertain" || current === "signin" ? "idle" : current,
          );
      } catch {
        if (mounted.current && !controller.signal.aborted) setReadState("error");
      } finally {
        reading.current = false;
      }
    },
    [enabled, endpoint],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft = body.trim();
    if (
      !draft ||
      !serverEnabled ||
      readState !== "ready" ||
      reading.current ||
      sending.current ||
      writeState === "uncertain" ||
      writeState === "signin"
    )
      return;
    sending.current = true;
    setWriteState("sending");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!mounted.current) return;
      if (response.status === 401) {
        setWriteState("signin");
        return;
      }
      if (!response.ok) {
        setWriteState(response.status >= 500 ? "uncertain" : "rejected");
        return;
      }
      parseViewerCommentAck(await response.json());
      if (!mounted.current) return;
      setBody("");
      setWriteState("posted");
      trackAnalyticsEvent("COMMENT", { videoId });
      sending.current = false;
      await load();
    } catch {
      if (mounted.current) setWriteState("uncertain");
    } finally {
      sending.current = false;
    }
  }

  const busy = readState === "loading" || writeState === "sending";
  return (
    <details
      className={styles.panel}
      onToggle={(event) => {
        if (event.currentTarget.open && readState === "idle") void load();
      }}
    >
      <summary data-tv-focusable="true" data-tv-focus-id={`comments-${videoId}`}>
        {t("title")}
      </summary>
      {!enabled || !serverEnabled ? (
        <StatusNotice tone="neutral">{t("disabled")}</StatusNotice>
      ) : (
        <>
          <div className={styles.toolbar}>
            <ActionButton
              type="button"
              tone="secondary"
              disabled={busy}
              onClick={() => void load()}
              data-tv-focusable="true"
              data-tv-focus-id="comments-refresh"
            >
              {readState === "error" ? t("retry") : t("refresh")}
            </ActionButton>
          </div>
          {readState === "error" ? (
            <StatusNotice tone="warning" announce="polite">
              {t("readError")}
            </StatusNotice>
          ) : null}
          {readState === "loading" ? (
            <StatusNotice announce="polite">{t("loading")}</StatusNotice>
          ) : null}
          {writeState === "uncertain" || writeState === "rejected" || writeState === "posted" ? (
            <StatusNotice announce="polite" tone={writeState === "posted" ? "success" : "warning"}>
              {t(writeState)}
            </StatusNotice>
          ) : null}
          {writeState === "signin" ? (
            <StatusNotice tone="info" announce="polite" title={t("signin")}>
              <p>{t("signinDescription")}</p>
              <ActionLink href={href("/login")} tone="secondary" data-tv-focusable="true">
                {t("signin")}
              </ActionLink>
            </StatusNotice>
          ) : null}
          <form className={styles.composer} onSubmit={submit} aria-label={t("join")}>
            <TextAreaField
              id={`comment-${videoId}`}
              label={t("join")}
              value={body}
              maxLength={3000}
              disabled={writeState === "sending" || writeState === "uncertain"}
              data-tv-focusable="true"
              data-tv-focus-id="comments-draft"
              onChange={(event) => {
                setBody(event.target.value);
                if (writeState === "rejected" || writeState === "posted") setWriteState("idle");
              }}
            />
            <ActionButton
              type="submit"
              pending={writeState === "sending"}
              disabled={
                !body.trim() ||
                busy ||
                readState !== "ready" ||
                writeState === "uncertain" ||
                writeState === "signin"
              }
              data-tv-focusable="true"
              data-tv-focus-id="comments-send"
            >
              {writeState === "sending" ? t("sending") : t("send")}
            </ActionButton>
          </form>
          <div className={styles.list}>
            {items.map((item) => (
              <CommentView item={item} key={item.id} />
            ))}
          </div>
          {readState === "ready" && items.length === 0 ? <p>{t("empty")}</p> : null}
          {cursor !== null && readState === "ready" ? (
            <ActionButton
              type="button"
              tone="secondary"
              disabled={busy || writeState === "uncertain"}
              onClick={() => void load(cursor)}
              data-tv-focusable="true"
              data-tv-focus-id="comments-more"
            >
              {t("more")}
            </ActionButton>
          ) : null}
        </>
      )}
    </details>
  );
}

function CommentView({ item }: { item: ViewerComment }) {
  const { locale, formatNumber, formatDate } = useI18n();
  const t = (key: ViewerCommentKey) => translateViewerComment(locale, key);
  return (
    <article className={styles.comment}>
      <header>
        <strong dir="auto">{item.authorProfile.name}</strong>
        {item.pinned ? <DataBadge>{t("pinned")}</DataBadge> : null}
        {item.creatorHearted ? <DataBadge tone="success">{t("hearted")}</DataBadge> : null}
      </header>
      <p dir="auto">{item.body}</p>
      <small>
        {translateViewerComment(locale, "likes", formatNumber(item.likeCount))}
        {item.edited ? ` · ${t("edited")}` : ""} ·{" "}
        <time dateTime={item.createdAt}>{formatDate(item.createdAt, { dateStyle: "medium" })}</time>
      </small>
      {item.replies.length ? (
        <div className={styles.replies}>
          {item.replies.map((reply) => (
            <CommentView item={reply} key={reply.id} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
