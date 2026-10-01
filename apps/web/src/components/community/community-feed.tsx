"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ActionButton, DataBadge, StatusNotice } from "@/components/ui/design-system";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import {
  communityMediaUrl,
  communityPostTypeKey,
  parseCommunityChannel,
  parseCommunityFeed,
  parseCommunityReaction,
  type CommunityPost,
} from "@/lib/community-viewer";
import { translateCommunityViewer } from "@/lib/i18n/community-viewer";

import styles from "./community-feed.module.css";

type Source = { kind: "following" } | { kind: "channel"; handle: string };
type UncertainAction = { postId: string; kind: "like" | "vote" | "report" };
type Feedback = { postId: string; kind: "uncertain" | "stale" };

export function CommunityFeed({
  source,
  initialItems,
}: {
  source: Source;
  initialItems?: CommunityPost[];
}) {
  const router = useRouter();
  const { locale, direction, href, formatDate, formatNumber } = useI18n();
  const t = useCallback(
    (
      key: Parameters<typeof translateCommunityViewer>[1],
      values: Parameters<typeof translateCommunityViewer>[2] = {},
    ) => translateCommunityViewer(locale, key, values),
    [locale],
  );
  const [items, setItems] = useState<CommunityPost[]>(initialItems ?? []);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    initialItems ? "ready" : "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<UncertainAction | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(() => new Set());
  const [reportedPosts, setReportedPosts] = useState<Set<string>>(() => new Set());
  const [reportTarget, setReportTarget] = useState<CommunityPost | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const activeRead = useRef<AbortController | null>(null);

  const signIn = useCallback(() => router.push(href("/login")), [href, router]);
  const endpoint =
    source.kind === "following"
      ? `${apiBaseUrl}/community/feed`
      : `${apiBaseUrl}/public/community/channels/${encodeURIComponent(source.handle)}`;

  const read = useCallback(
    async (controller: AbortController): Promise<CommunityPost[] | null> => {
      const response = await fetch(endpoint, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        signIn();
        return null;
      }
      if (!response.ok) throw new Error("COMMUNITY_UNAVAILABLE");
      const payload = await response.json();
      return source.kind === "following"
        ? parseCommunityFeed(payload)
        : parseCommunityChannel(payload).items;
    },
    [endpoint, signIn, source.kind],
  );

  useEffect(() => {
    if (initialItems && attempt === 0) return;
    const controller = new AbortController();
    activeRead.current?.abort();
    activeRead.current = controller;
    void read(controller)
      .then((next) => {
        if (!next || controller.signal.aborted) return;
        setItems(next);
        setLoadState("ready");
        setFeedback(null);
        if (uncertain?.kind !== "report") setUncertain(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState("error");
      });
    return () => controller.abort();
  }, [attempt, initialItems, read, uncertain?.kind]);

  async function refreshAfterConfirmed(postId: string) {
    const controller = new AbortController();
    activeRead.current?.abort();
    activeRead.current = controller;
    try {
      const next = await read(controller);
      if (!next) return false;
      setItems(next);
      setFeedback(null);
      return true;
    } catch {
      setFeedback({ postId, kind: "stale" });
      return false;
    }
  }

  function retry() {
    setLoadState("loading");
    setAttempt((value) => value + 1);
  }

  function mutationBlocked(postId: string) {
    return Boolean(pending) || uncertain?.postId === postId;
  }

  async function like(post: CommunityPost) {
    if (mutationBlocked(post.id)) return;
    const key = `like:${post.id}`;
    setPending(key);
    setFeedback(null);
    try {
      const response = await fetch(`${apiBaseUrl}/community/posts/${post.id}/reaction`, {
        method: "PUT",
        credentials: "include",
      });
      if (response.status === 401) {
        signIn();
        return;
      }
      if (!response.ok) throw new Error("LIKE_UNCONFIRMED");
      const result = parseCommunityReaction(await response.json());
      setItems((current) =>
        current.map((item) =>
          item.id === post.id
            ? { ...item, _count: { ...item._count, reactions: result.likeCount } }
            : item,
        ),
      );
      setLikedPosts((current) => new Set(current).add(post.id));
      setUncertain(null);
    } catch {
      setUncertain({ postId: post.id, kind: "like" });
      setFeedback({ postId: post.id, kind: "uncertain" });
    } finally {
      setPending(null);
    }
  }

  async function vote(post: CommunityPost, optionId: string) {
    if (mutationBlocked(post.id)) return;
    const key = `vote:${post.id}:${optionId}`;
    setPending(key);
    setFeedback(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/community/posts/${post.id}/poll/${optionId}`,
        { method: "PUT", credentials: "include" },
      );
      if (response.status === 401) {
        signIn();
        return;
      }
      if (!response.ok) throw new Error("VOTE_UNCONFIRMED");
      setUncertain(null);
      await refreshAfterConfirmed(post.id);
    } catch {
      setUncertain({ postId: post.id, kind: "vote" });
      setFeedback({ postId: post.id, kind: "uncertain" });
    } finally {
      setPending(null);
    }
  }

  async function report(post: CommunityPost) {
    if (mutationBlocked(post.id)) return;
    const key = `report:${post.id}`;
    setPending(key);
    setFeedback(null);
    try {
      const response = await fetch(`${apiBaseUrl}/community/posts/${post.id}/reports`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "OTHER", details: "Reported from Community Viewer" }),
      });
      if (response.status === 401) {
        signIn();
        return;
      }
      if (!response.ok) throw new Error("REPORT_UNCONFIRMED");
      setReportedPosts((current) => new Set(current).add(post.id));
      setUncertain(null);
    } catch {
      setUncertain({ postId: post.id, kind: "report" });
      setFeedback({ postId: post.id, kind: "uncertain" });
    } finally {
      setPending(null);
      setReportTarget(null);
    }
  }

  if (loadState === "loading") {
    return <StatusNotice announce="polite">{t("community.loading")}</StatusNotice>;
  }

  if (loadState === "error") {
    return (
      <ErrorState
        title={t("community.loadErrorTitle")}
        description={t("community.loadErrorDescription")}
        action={
          <ActionButton
            tone="secondary"
            type="button"
            data-tv-focusable="true"
            data-tv-focus-id="community-retry"
            onClick={retry}
          >
            {t("community.retry")}
          </ActionButton>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={t("community.emptyTitle")}
        description={
          source.kind === "channel"
            ? t("community.channelEmptyDescription")
            : t("community.emptyDescription")
        }
      />
    );
  }

  return (
    <>
      <div className={styles.workspace}>
        <ul className={styles.list}>
          {items.map((post) => {
            const liked = likedPosts.has(post.id);
            const reported = reportedPosts.has(post.id);
            const postFeedback = feedback?.postId === post.id ? feedback.kind : null;
            const isUncertain = uncertain?.postId === post.id;
            const timestamp = post.publishedAt ?? post.scheduledPublishAt ?? post.createdAt;

            return (
              <li className={styles.post} id={post.id} key={post.id}>
                <article>
                  <header className={styles.header}>
                    <div>
                      <Link className={styles.channel} href={href(`/c/${post.channel.handle}`)}>
                        @{post.channel.handle}
                      </Link>
                      <div className={styles.meta}>
                        <DataBadge>{t(communityPostTypeKey(post.type))}</DataBadge>
                        <time dateTime={timestamp}>
                          {formatDate(timestamp, { dateStyle: "medium", timeStyle: "short" })}
                        </time>
                      </div>
                    </div>
                  </header>

                  {post.body ? <p className={styles.body} dir="auto">{post.body}</p> : null}

                  {post.imageAsset ? (
                    <div className={styles.imageWrap}>
                      {failedImages.has(post.id) ? (
                        <div className={styles.imageFallback}>
                          {t("community.photoAlt", { name: post.channel.name })}
                        </div>
                      ) : (
                        <Image
                          alt={post.body?.slice(0, 160) || t("community.photoAlt", { name: post.channel.name })}
                          fill
                          sizes="(max-width: 780px) 100vw, 780px"
                          src={communityMediaUrl(post.imageAsset.r2ObjectKey)}
                          unoptimized
                          onError={() =>
                            setFailedImages((current) => new Set(current).add(post.id))
                          }
                        />
                      )}
                    </div>
                  ) : null}

                  {post.sharedVideo ? (
                    <Link
                      className={styles.videoShare}
                      data-tv-focusable="true"
                      data-tv-focus-id={`community-video-${post.id}`}
                      href={href(`/watch/${post.sharedVideo.slug}`)}
                    >
                      <span aria-hidden="true">▶</span>
                      <span>{t("community.watchVideo", { title: post.sharedVideo.title })}</span>
                    </Link>
                  ) : null}

                  {post.pollOptions.length ? (
                    <div className={styles.poll}>
                      {post.pollOptions.map((option) => {
                        const busy = pending === `vote:${post.id}:${option.id}`;
                        return (
                          <ActionButton
                            key={option.id}
                            tone="secondary"
                            type="button"
                            pending={busy}
                            disabled={mutationBlocked(post.id)}
                            data-tv-focusable="true"
                            data-tv-focus-id={`community-poll-${post.id}-${option.id}`}
                            aria-label={t("community.vote", {
                              option: option.label,
                              count: formatNumber(option._count.votes),
                            })}
                            onClick={() => void vote(post, option.id)}
                          >
                            <span dir="auto">{option.label}</span>
                            <span>{formatNumber(option._count.votes)}</span>
                          </ActionButton>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className={styles.actions}>
                    <ActionButton
                      tone="quiet"
                      type="button"
                      aria-pressed={liked}
                      pending={pending === `like:${post.id}`}
                      disabled={mutationBlocked(post.id)}
                      data-tv-focusable="true"
                      data-tv-focus-id={`community-like-${post.id}`}
                      onClick={() => void like(post)}
                    >
                      {liked ? t("community.liked") : t("community.like")} ·{" "}
                      {formatNumber(post._count.reactions)}
                    </ActionButton>
                    <span className={styles.count}>
                      {t("community.comments", { count: formatNumber(post._count.comments) })}
                    </span>
                    {reported ? (
                      <DataBadge tone="success">{t("community.reported")}</DataBadge>
                    ) : (
                      <ActionButton
                        tone="quiet"
                        type="button"
                        disabled={mutationBlocked(post.id)}
                        data-tv-focusable="true"
                        data-tv-focus-id={`community-report-${post.id}`}
                        onClick={() => setReportTarget(post)}
                      >
                        {t("community.report")}
                      </ActionButton>
                    )}
                  </div>

                  {postFeedback ? (
                    <div className={styles.feedback}>
                      <StatusNotice tone="warning" announce="polite">
                        {uncertain?.kind === "report"
                          ? t("community.reportUncertain")
                          : postFeedback === "stale"
                            ? t("community.savedRefreshError")
                            : t("community.actionUncertain")}
                      </StatusNotice>
                      {isUncertain && uncertain?.kind !== "report" ? (
                        <div className={styles.feedbackActions}>
                          <ActionButton
                            tone="secondary"
                            type="button"
                            data-tv-focusable="true"
                            data-tv-focus-id={`community-refresh-${post.id}`}
                            onClick={retry}
                          >
                            {t("community.refresh")}
                          </ActionButton>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      </div>

      <ConfirmationDialog
        open={Boolean(reportTarget)}
        direction={direction}
        title={t("community.reportTitle")}
        description={t("community.reportDescription")}
        confirmLabel={t("community.reportConfirm")}
        cancelLabel={t("community.cancel")}
        busy={Boolean(reportTarget && pending === `report:${reportTarget.id}`)}
        onCancel={() => setReportTarget(null)}
        onConfirm={() => {
          if (reportTarget) void report(reportTarget);
        }}
      />
    </>
  );
}
