"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Disclosure } from "@/components/ui/data-presentation";
import {
  ActionButton,
  ActionLink,
  SelectField,
  StatusNotice,
  TextAreaField,
} from "@/components/ui/design-system";
import { MediaArtwork } from "@/components/viewer/media-artwork";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import {
  parseCommunityChannelFeed,
  parseCommunityFeed,
  parseCommunityPollAck,
  parseCommunityReaction,
  parseCommunityReport,
  type CommunityFeedItem,
} from "@/lib/community-contracts";
import { translateCommunity } from "@/lib/i18n/community";

import styles from "./community-feed.module.css";

type FeedStatus = "loading" | "ready" | "error" | "unavailable";
type ReportReason =
  | "COPYRIGHT"
  | "SPAM"
  | "HARASSMENT"
  | "HATE"
  | "SEXUAL_CONTENT"
  | "VIOLENCE"
  | "MISLEADING"
  | "OTHER";

const reportReasons: Array<[ReportReason, Parameters<typeof translateCommunity>[1]]> = [
  ["COPYRIGHT", "community.reasonCopyright"],
  ["SPAM", "community.reasonSpam"],
  ["HARASSMENT", "community.reasonHarassment"],
  ["HATE", "community.reasonHate"],
  ["SEXUAL_CONTENT", "community.reasonSexual"],
  ["VIOLENCE", "community.reasonViolence"],
  ["MISLEADING", "community.reasonMisleading"],
  ["OTHER", "community.reasonOther"],
];

export function CommunityFollowingFeed() {
  return <CommunityFeedWorkspace kind="following" />;
}

export function CommunityChannelFeed({
  handle,
  initialItems,
}: {
  handle: string;
  initialItems?: CommunityFeedItem[];
}) {
  return <CommunityFeedWorkspace kind="channel" handle={handle} initialItems={initialItems} />;
}

function CommunityFeedWorkspace({
  kind,
  handle,
  initialItems,
}: {
  kind: "following" | "channel";
  handle?: string;
  initialItems?: CommunityFeedItem[];
}) {
  const router = useRouter();
  const { href, locale } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateCommunity>[1], values = {}) =>
      translateCommunity(locale, key, values),
    [locale],
  );
  const [items, setItems] = useState<CommunityFeedItem[]>(initialItems ?? []);
  const [status, setStatus] = useState<FeedStatus>(initialItems ? "ready" : "loading");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);

  const endpoint =
    kind === "following"
      ? "/community/feed"
      : `/public/community/channels/${encodeURIComponent(handle ?? "")}`;

  const load = useCallback(
    async (initial = false) => {
      if (initial) setStatus("loading");
      else setRefreshing(true);
      setRefreshError(false);
      try {
        const response = await fetch(`${apiBaseUrl}${endpoint}`, {
          credentials: kind === "following" ? "include" : "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) {
          router.push(href("/login"));
          return false;
        }
        if (response.status === 404) {
          if (initial) setStatus("unavailable");
          else setRefreshError(true);
          return false;
        }
        if (!response.ok) throw new Error("COMMUNITY_UNAVAILABLE");
        const next =
          kind === "following"
            ? parseCommunityFeed(await response.json())
            : parseCommunityChannelFeed(await response.json()).items;
        setItems(next);
        setStatus("ready");
        return true;
      } catch {
        if (initial) setStatus("error");
        else setRefreshError(true);
        return false;
      } finally {
        setRefreshing(false);
      }
    },
    [endpoint, href, kind, router],
  );

  useEffect(() => {
    if (initialItems === undefined) void load(true);
  }, [initialItems, load]);

  if (status === "loading") {
    return <StatusNotice announce="polite">{t("community.loading")}</StatusNotice>;
  }
  if (status === "unavailable") {
    return (
      <ErrorState
        title={t("community.unavailableTitle")}
        description={t("community.unavailableDescription")}
      />
    );
  }
  if (status === "error") {
    return (
      <ErrorState
        title={t("community.errorTitle")}
        description={t("community.errorDescription")}
        action={
          <ActionButton
            tone="secondary"
            type="button"
            data-tv-focusable="true"
            data-tv-focus-id="community-retry"
            onClick={() => void load(true)}
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
          kind === "following"
            ? t("community.emptyDescription")
            : t("community.channelEmptyDescription")
        }
      />
    );
  }

  return (
    <section aria-label={t("community.feedLabel")} className={styles.feed}>
      {refreshError ? (
        <StatusNotice tone="warning" announce="polite">
          {t("community.refreshError")}
        </StatusNotice>
      ) : null}
      {items.map((post) => (
        <CommunityPostCard
          item={post}
          key={post.id}
          onRefresh={() => load(false)}
          refreshing={refreshing}
        />
      ))}
    </section>
  );
}

function CommunityPostCard({
  item,
  onRefresh,
  refreshing,
}: {
  item: CommunityFeedItem;
  onRefresh: () => Promise<boolean>;
  refreshing: boolean;
}) {
  const router = useRouter();
  const { formatDate, formatNumber, href, locale } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateCommunity>[1], values = {}) =>
      translateCommunity(locale, key, values),
    [locale],
  );
  const [liked, setLiked] = useState<boolean | null>(null);
  const [reactionCount, setReactionCount] = useState(item._count.reactions);
  const [selectedPoll, setSelectedPoll] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reaction" | "poll" | "report" | null>(null);
  const [uncertain, setUncertain] = useState<"reaction" | "poll" | "report" | null>(null);
  const [actionError, setActionError] = useState(false);
  const [message, setMessage] = useState<"vote" | "report" | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason | "">("");
  const [reportDetails, setReportDetails] = useState("");
  const imageUrl = mediaAssetUrl(item.imageAsset?.r2ObjectKey);
  const timestamp = item.publishedAt ?? item.scheduledPublishAt ?? item.createdAt;

  async function reconcile() {
    const ok = await onRefresh();
    if (ok) {
      setUncertain(null);
      setActionError(false);
      setMessage(null);
      setLiked(null);
      setSelectedPoll(null);
    }
  }

  async function react() {
    if (busy || uncertain === "reaction") return;
    setBusy("reaction");
    setActionError(false);
    try {
      const response = await fetch(`${apiBaseUrl}/community/posts/${item.id}/reaction`, {
        method: liked ? "DELETE" : "PUT",
        credentials: "include",
      });
      if (response.status === 401) {
        router.push(href("/login"));
        return;
      }
      if (!response.ok) {
        setActionError(true);
        return;
      }
      const result = parseCommunityReaction(await response.json(), item.id);
      setLiked(result.liked);
      setReactionCount(result.likeCount);
    } catch {
      setUncertain("reaction");
    } finally {
      setBusy(null);
    }
  }

  async function vote(optionId: string) {
    if (busy || uncertain === "poll") return;
    setBusy("poll");
    setActionError(false);
    try {
      const response = await fetch(
        `${apiBaseUrl}/community/posts/${item.id}/poll/${optionId}`,
        { method: "PUT", credentials: "include" },
      );
      if (response.status === 401) {
        router.push(href("/login"));
        return;
      }
      if (!response.ok) {
        setActionError(true);
        return;
      }
      parseCommunityPollAck(await response.json(), item.id, optionId);
      setSelectedPoll(optionId);
      setMessage("vote");
      await onRefresh();
    } catch {
      setUncertain("poll");
    } finally {
      setBusy(null);
    }
  }

  async function report() {
    if (busy || uncertain === "report" || !reportReason) return;
    setBusy("report");
    setActionError(false);
    try {
      const response = await fetch(`${apiBaseUrl}/community/posts/${item.id}/reports`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: reportReason,
          details: reportDetails.trim() || null,
        }),
      });
      if (response.status === 401) {
        router.push(href("/login"));
        return;
      }
      if (!response.ok) {
        setActionError(true);
        return;
      }
      parseCommunityReport(await response.json());
      setMessage("report");
    } catch {
      setUncertain("report");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className={styles.card} id={item.id}>
      <header className={styles.cardHeader}>
        <div>
          <Link className={styles.channel} href={href(`/c/${item.channel.handle}`)}>
            <strong dir="auto">{item.channel.name}</strong>
            <span dir="ltr">@{item.channel.handle}</span>
          </Link>
          <time dateTime={timestamp}>{formatDate(timestamp, { dateStyle: "medium" })}</time>
        </div>
      </header>

      {item.body ? <p className={styles.body} dir="auto">{item.body}</p> : null}

      {imageUrl ? (
        <div className={styles.image} aria-label={t("community.imageAlt", { name: item.channel.name })}>
          <MediaArtwork src={imageUrl} sizes="(max-width: 760px) 92vw, 46rem" />
        </div>
      ) : null}

      {item.sharedVideo ? (
        <div className={styles.sharedVideo}>
          <strong dir="auto">{item.sharedVideo.title}</strong>
          <ActionLink tone="secondary" href={href(`/watch/${item.sharedVideo.slug}`)}>
            {t("community.watchVideo")}
          </ActionLink>
        </div>
      ) : null}

      {item.pollOptions.length > 0 ? (
        <div className={styles.poll}>
          {item.pollOptions.map((option) => (
            <ActionButton
              key={option.id}
              tone={selectedPoll === option.id ? "primary" : "secondary"}
              type="button"
              pending={busy === "poll" && selectedPoll === option.id}
              disabled={Boolean(busy) || uncertain === "poll"}
              data-tv-focusable="true"
              data-tv-focus-id={`community-poll-${item.id}-${option.id}`}
              onClick={() => void vote(option.id)}
            >
              <span dir="auto">{option.label}</span>
              <small>
                {t("community.pollVotes", { count: formatNumber(option._count.votes) })}
              </small>
            </ActionButton>
          ))}
        </div>
      ) : null}

      <div className={styles.actions}>
        <ActionButton
          tone={liked ? "primary" : "secondary"}
          type="button"
          aria-pressed={liked === true}
          pending={busy === "reaction"}
          disabled={Boolean(busy) || uncertain === "reaction"}
          data-tv-focusable="true"
          data-tv-focus-id={`community-like-${item.id}`}
          onClick={() => void react()}
        >
          {liked ? t("community.liked") : t("community.like")} · {formatNumber(reactionCount)}
        </ActionButton>
        <span className={styles.comments}>
          {t("community.commentsCount", { count: formatNumber(item._count.comments) })}
        </span>
      </div>

      {message === "vote" ? (
        <StatusNotice tone="success" announce="polite">{t("community.voteRecorded")}</StatusNotice>
      ) : null}
      {message === "report" ? (
        <StatusNotice tone="success" announce="polite">{t("community.reportSent")}</StatusNotice>
      ) : null}
      {actionError ? (
        <StatusNotice tone="warning" announce="polite">{t("community.actionError")}</StatusNotice>
      ) : null}
      {uncertain === "reaction" || uncertain === "poll" ? (
        <StatusNotice tone="warning" announce="polite">
          {t("community.actionUncertain")}
          <span className={styles.noticeAction}>
            <ActionButton
              tone="secondary"
              type="button"
              pending={refreshing}
              data-tv-focusable="true"
              data-tv-focus-id={`community-refresh-${item.id}`}
              onClick={() => void reconcile()}
            >
              {t("community.refresh")}
            </ActionButton>
          </span>
        </StatusNotice>
      ) : null}
      {uncertain === "report" ? (
        <StatusNotice tone="warning" announce="polite">
          {t("community.reportUncertain")}
        </StatusNotice>
      ) : null}

      {message !== "report" && uncertain !== "report" ? (
        <Disclosure className={styles.report} summary={t("community.report")}>
          <SelectField
            id={`community-report-reason-${item.id}`}
            label={t("community.reportReason")}
            value={reportReason}
            disabled={busy === "report"}
            onChange={(event) => setReportReason(event.target.value as ReportReason | "")}
          >
            <option value="">{t("community.reportChooseReason")}</option>
            {reportReasons.map(([value, label]) => (
              <option key={value} value={value}>{t(label)}</option>
            ))}
          </SelectField>
          <TextAreaField
            id={`community-report-details-${item.id}`}
            label={t("community.reportDetails")}
            maxLength={2000}
            value={reportDetails}
            disabled={busy === "report"}
            onChange={(event) => setReportDetails(event.target.value)}
          />
          <ActionButton
            tone="secondary"
            type="button"
            pending={busy === "report"}
            disabled={!reportReason || Boolean(busy)}
            data-tv-focusable="true"
            data-tv-focus-id={`community-report-${item.id}`}
            onClick={() => void report()}
          >
            {busy === "report" ? t("community.reportSending") : t("community.reportSubmit")}
          </ActionButton>
          {actionError ? <p className={styles.inlineError}>{t("community.reportError")}</p> : null}
        </Disclosure>
      ) : null}
    </article>
  );
}
