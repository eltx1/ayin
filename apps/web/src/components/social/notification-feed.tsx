"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, DataBadge, StatusNotice } from "@/components/ui/design-system";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import { translateNotification } from "@/lib/i18n/notifications";
import {
  mergeNotificationPages,
  notificationTypeKey,
  parseNotificationPage,
  type NotificationItem,
} from "@/lib/notifications";

import styles from "./notification-feed.module.css";

type LoadState = "loading" | "ready" | "error";

export function NotificationFeed() {
  const router = useRouter();
  const { locale, href, formatDate } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateNotification>[1]) => translateNotification(locale, key),
    [locale],
  );
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [uncertainId, setUncertainId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const activeRead = useRef<AbortController | null>(null);

  const signIn = useCallback(() => router.push(href("/login")), [href, router]);

  useEffect(() => {
    const controller = new AbortController();
    activeRead.current?.abort();
    activeRead.current = controller;

    void fetch(`${apiBaseUrl}/social/notifications`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          signIn();
          return null;
        }
        if (!response.ok) throw new Error("NOTIFICATIONS_UNAVAILABLE");
        return parseNotificationPage(await response.json());
      })
      .then((page) => {
        if (!page || controller.signal.aborted) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setUncertainId(null);
        setLoadMoreError(false);
        setLoadState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState("error");
      });

    return () => controller.abort();
  }, [attempt, signIn]);

  function retry() {
    setLoadState("loading");
    setAttempt((value) => value + 1);
  }

  async function loadMore() {
    if (nextCursor === null || loadMorePending) return;
    setLoadMorePending(true);
    setLoadMoreError(false);
    try {
      const response = await fetch(
        `${apiBaseUrl}/social/notifications?${new URLSearchParams({
          cursor: String(nextCursor),
        })}`,
        { credentials: "include", cache: "no-store" },
      );
      if (response.status === 401) {
        signIn();
        return;
      }
      if (!response.ok) throw new Error("NOTIFICATIONS_UNAVAILABLE");
      const page = parseNotificationPage(await response.json());
      setItems((current) => mergeNotificationPages(current, page.items));
      setNextCursor(page.nextCursor);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadMorePending(false);
    }
  }

  async function markRead(id: string) {
    if (markingId || uncertainId === id) return;
    setMarkingId(id);
    try {
      const response = await fetch(`${apiBaseUrl}/social/notifications/${id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
      if (response.status === 401) {
        signIn();
        return;
      }
      if (!response.ok) throw new Error("MARK_READ_UNCONFIRMED");
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
    } catch {
      // Do not replay an uncertain write. A refresh reconciles the server state first.
      setUncertainId(id);
    } finally {
      setMarkingId(null);
    }
  }

  if (loadState === "loading") {
    return (
      <StatusNotice announce="polite">
        {t("notifications.loading")}
      </StatusNotice>
    );
  }

  if (loadState === "error") {
    return (
      <ErrorState
        title={t("notifications.loadError")}
        description={t("notifications.description")}
        action={
          <ActionButton
            type="button"
            tone="secondary"
            data-tv-focusable="true"
            data-tv-focus-id="notifications-retry"
            onClick={retry}
          >
            {t("notifications.retry")}
          </ActionButton>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("notifications.emptyTitle")}
        description={t("notifications.emptyDescription")}
      />
    );
  }

  return (
    <section aria-label={t("notifications.list")} className={styles.workspace}>
      <ul className={styles.list}>
        {items.map((item) => {
          const uncertain = uncertainId === item.id;
          const marking = markingId === item.id;
          return (
            <li className={styles.item} data-read={Boolean(item.readAt)} key={item.id}>
              <div className={styles.copy}>
                <div className={styles.meta}>
                  <DataBadge>{t(notificationTypeKey(item.type))}</DataBadge>
                  <time dateTime={item.createdAt}>
                    {formatDate(item.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </div>
                <strong dir="auto">{item.title}</strong>
                {item.body ? <p dir="auto">{item.body}</p> : null}
                {uncertain ? (
                  <StatusNotice tone="warning" announce="polite">
                    {t("notifications.markUncertain")}
                  </StatusNotice>
                ) : null}
              </div>
              {!item.readAt ? (
                <ActionButton
                  type="button"
                  tone="secondary"
                  data-tv-focusable="true"
                  data-tv-focus-id={`notification-${item.id}-mark-read`}
                  pending={marking}
                  disabled={Boolean(markingId) || uncertain}
                  onClick={() => void markRead(item.id)}
                >
                  {marking ? t("notifications.marking") : t("notifications.markRead")}
                </ActionButton>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className={styles.footer}>
        {uncertainId ? (
          <ActionButton
            type="button"
            tone="secondary"
            data-tv-focusable="true"
            data-tv-focus-id="notifications-refresh"
            onClick={retry}
          >
            {t("notifications.refresh")}
          </ActionButton>
        ) : null}
        {nextCursor !== null ? (
          <ActionButton
            type="button"
            tone="secondary"
            data-tv-focusable="true"
            data-tv-focus-id="notifications-load-more"
            pending={loadMorePending}
            disabled={loadMorePending}
            onClick={() => void loadMore()}
          >
            {loadMorePending ? t("notifications.loadingMore") : t("notifications.loadMore")}
          </ActionButton>
        ) : null}
      </div>
      {loadMoreError ? (
        <StatusNotice tone="warning" announce="polite">
          {t("notifications.moreError")}
        </StatusNotice>
      ) : null}
    </section>
  );
}
