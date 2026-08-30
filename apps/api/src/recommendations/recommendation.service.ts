import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import type {
  RecommendationContext,
  RecommendationItem,
  RecommendationReason,
  RecommendationServiceContract,
} from "./recommendation.types.js";

const playableVideoWhere = {
  status: "PUBLISHED" as const,
  visibility: "PUBLIC" as const,
  removedAt: null,
  channel: { status: "ACTIVE" as const, removedAt: null },
  mediaAssets: {
    some: {
      kind: "SOURCE_VIDEO" as const,
      status: { in: ["UPLOADED" as const, "VALIDATED" as const] },
      removedAt: null,
      mimeType: "video/mp4",
    },
  },
};

interface Weights {
  history: number;
  subscriptions: number;
  likes: number;
  popularity: number;
  recency: number;
  completion: number;
}

interface ProfileSignals {
  subscribedChannels: Set<string>;
  historyAffinity: Map<string, number>;
  likedChannels: Set<string>;
  completedChannels: Set<string>;
  excludedVideos: Set<string>;
}

@Injectable()
export class RecommendationService implements RecommendationServiceContract {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async resolveProfile(accountId: string, requestedProfileId?: string) {
    const profile = requestedProfileId
      ? await this.database.client.viewerProfile.findFirst({
          where: { id: requestedProfileId, accountId, deletedAt: null },
          select: { id: true },
        })
      : await this.database.client.viewerProfile.findFirst({
          where: { accountId, isDefault: true, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
    if (!profile) throw new RecommendationError("PROFILE_NOT_FOUND", "A viewer profile is required.", 403);
    return profile.id;
  }

  async getHomeRecommendations(profileId: string, context: RecommendationContext = {}) {
    return this.rankVideos(profileId, { limit: context.limit ?? 24 });
  }

  async getUpNext(videoId: string, profileId: string) {
    const related = await this.rankVideos(profileId, { limit: 12, relatedToVideoId: videoId });
    return { ...related, items: related.items.slice(0, 1) };
  }

  async getRelated(videoId: string, profileId: string) {
    return this.rankVideos(profileId, { limit: 18, relatedToVideoId: videoId });
  }

  async getShortsFeed(profileId: string, context: RecommendationContext = {}) {
    return this.rankVideos(profileId, { limit: context.limit ?? 24, videoForm: "CLIP" });
  }

  async getTvSuggestions(profileId: string, context: RecommendationContext = {}) {
    const limit = clamp(context.limit ?? 12, 1, 24);
    const signals = await this.loadSignals(profileId);
    const rows = await this.database.client.creatorTvChannel.findMany({
      where: {
        status: "ACTIVE",
        disabledAt: null,
        channel: { status: "ACTIVE", removedAt: null },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 60,
      select: {
        id: true,
        name: true,
        slug: true,
        channelId: true,
        createdAt: true,
        channel: { select: { handle: true, name: true } },
      },
    });
    const ranked = rows
      .map((tv) => {
        const followed = signals.subscribedChannels.has(tv.channelId);
        const affinity = signals.historyAffinity.get(tv.channelId) ?? 0;
        const score = (followed ? 60 : 0) + Math.min(30, affinity * 8) + recencyScore(tv.createdAt) * 10;
        return {
          id: tv.id,
          name: tv.name,
          href: `/c/${tv.channel.handle}/tv`,
          channelId: tv.channelId,
          channelName: tv.channel.name,
          score: roundScore(score),
          reason: followed
            ? { code: "FOLLOWED_CHANNEL" as const, label: "From a channel you follow" }
            : affinity > 0
              ? { code: "CHANNEL_AFFINITY" as const, label: "Because you watch this creator" }
              : { code: "SAFE_FALLBACK" as const, label: "Active Creator TV" },
        };
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
    return { profileId, mode: "HEURISTIC_V1" as const, items: ranked };
  }

  async markNotInterested(profileId: string, videoId: string) {
    await this.assertVideoExists(videoId);
    await this.database.client.recommendationFeedback.upsert({
      where: { profileId_videoId: { profileId, videoId } },
      update: { type: "NOT_INTERESTED" },
      create: { profileId, videoId, type: "NOT_INTERESTED" },
    });
    return { profileId, videoId, state: "NOT_INTERESTED" as const };
  }

  async dismiss(profileId: string, videoId: string) {
    await this.assertVideoExists(videoId);
    await this.database.client.recommendationFeedback.upsert({
      where: { profileId_videoId: { profileId, videoId } },
      update: { type: "DISMISSED" },
      create: { profileId, videoId, type: "DISMISSED" },
    });
    return { profileId, videoId, state: "DISMISSED" as const };
  }

  async resetPersonalization(profileId: string) {
    const now = new Date();
    await this.database.client.$transaction([
      this.database.client.recommendationFeedback.deleteMany({ where: { profileId } }),
      this.database.client.recommendationProfileState.upsert({
        where: { profileId },
        update: { resetAt: now },
        create: { profileId, resetAt: now },
      }),
    ]);
    return { profileId, resetAt: now.toISOString() };
  }

  private async rankVideos(
    profileId: string,
    input: { limit: number; videoForm?: "CLIP"; relatedToVideoId?: string },
  ) {
    const limit = clamp(input.limit, 1, 48);
    const [personalizationEnabled, weights, signals] = await Promise.all([
      this.settings.get("recommendationsPersonalizedEnabled") as Promise<boolean>,
      this.loadWeights(),
      this.loadSignals(profileId),
    ]);
    const related = input.relatedToVideoId
      ? await this.database.client.video.findFirst({
          where: { id: input.relatedToVideoId, ...playableVideoWhere },
          select: { id: true, channelId: true },
        })
      : null;

    const candidates = await this.database.client.video.findMany({
      where: {
        ...playableVideoWhere,
        ...(input.videoForm ? { videoForm: input.videoForm } : {}),
        ...(related ? { id: { not: related.id } } : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 160,
      select: {
        id: true,
        slug: true,
        title: true,
        channelId: true,
        publishedAt: true,
        channel: { select: { handle: true, name: true } },
        mediaAssets: {
          where: {
            kind: "THUMBNAIL",
            status: { in: ["UPLOADED", "VALIDATED"] },
            removedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { r2ObjectKey: true },
        },
        _count: { select: { watchHistory: true, reactions: true } },
      },
    });

    const personalized = personalizationEnabled && this.hasPersonalSignals(signals);
    const items = candidates
      .filter((video) => !signals.excludedVideos.has(video.id))
      .map((video) => {
        const followed = signals.subscribedChannels.has(video.channelId);
        const historyAffinity = signals.historyAffinity.get(video.channelId) ?? 0;
        const likedChannel = signals.likedChannels.has(video.channelId);
        const completedChannel = signals.completedChannels.has(video.channelId);
        const relatedChannel = related?.channelId === video.channelId;
        const popularity = Math.min(1, Math.log1p(video._count.watchHistory + video._count.reactions) / 5);
        const recent = recencyScore(video.publishedAt ?? new Date(0));
        const score = personalized
          ? (followed ? weights.subscriptions : 0) +
            Math.min(1, historyAffinity / 3) * weights.history +
            (likedChannel ? weights.likes : 0) +
            (completedChannel ? weights.completion : 0) +
            popularity * weights.popularity +
            recent * weights.recency +
            (relatedChannel ? 20 : 0)
          : popularity * 35 + recent * 65 + (relatedChannel ? 20 : 0);
        return this.toItem(video, roundScore(score), this.reason({
          followed,
          historyAffinity,
          likedChannel,
          completedChannel,
          relatedChannel,
          popularity,
          recent,
          personalized,
        }));
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);

    return {
      profileId,
      mode: personalized ? ("HEURISTIC_V1" as const) : ("SAFE_FALLBACK" as const),
      algorithm: "explainable-weighted-scoring-v1",
      weights,
      items,
    };
  }

  private async loadWeights(): Promise<Weights> {
    const [history, subscriptions, likes, popularity, recency, completion] = await Promise.all([
      this.settings.get("recommendationWeightHistory"),
      this.settings.get("recommendationWeightSubscriptions"),
      this.settings.get("recommendationWeightLikes"),
      this.settings.get("recommendationWeightPopularity"),
      this.settings.get("recommendationWeightRecency"),
      this.settings.get("recommendationWeightCompletion"),
    ]);
    return {
      history: history as number,
      subscriptions: subscriptions as number,
      likes: likes as number,
      popularity: popularity as number,
      recency: recency as number,
      completion: completion as number,
    };
  }

  private async loadSignals(profileId: string): Promise<ProfileSignals> {
    const state = await this.database.client.recommendationProfileState.findUnique({
      where: { profileId },
      select: { resetAt: true },
    });
    const since = state?.resetAt;
    const [subscriptions, history, likes, completed, feedback] = await Promise.all([
      this.database.client.subscription.findMany({
        where: { profileId, ...(since ? { createdAt: { gte: since } } : {}) },
        select: { channelId: true },
      }),
      this.database.client.watchHistory.findMany({
        where: { profileId, ...(since ? { lastWatchedAt: { gte: since } } : {}) },
        orderBy: { lastWatchedAt: "desc" },
        take: 100,
        select: { viewCount: true, video: { select: { channelId: true } } },
      }),
      this.database.client.reaction.findMany({
        where: {
          profileId,
          type: "LIKE",
          videoId: { not: null },
          ...(since ? { createdAt: { gte: since } } : {}),
        },
        take: 100,
        select: { video: { select: { channelId: true } } },
      }),
      this.database.client.watchProgress.findMany({
        where: {
          profileId,
          completedAt: { not: null },
          ...(since ? { lastWatchedAt: { gte: since } } : {}),
        },
        take: 100,
        select: { video: { select: { channelId: true } } },
      }),
      this.database.client.recommendationFeedback.findMany({
        where: { profileId, type: "NOT_INTERESTED" },
        select: { videoId: true },
      }),
    ]);
    const historyAffinity = new Map<string, number>();
    for (const row of history) {
      historyAffinity.set(row.video.channelId, (historyAffinity.get(row.video.channelId) ?? 0) + row.viewCount);
    }
    return {
      subscribedChannels: new Set(subscriptions.map((row) => row.channelId)),
      historyAffinity,
      likedChannels: new Set(likes.flatMap((row) => (row.video ? [row.video.channelId] : []))),
      completedChannels: new Set(completed.map((row) => row.video.channelId)),
      excludedVideos: new Set(feedback.map((row) => row.videoId)),
    };
  }

  private hasPersonalSignals(signals: ProfileSignals) {
    return (
      signals.subscribedChannels.size > 0 ||
      signals.historyAffinity.size > 0 ||
      signals.likedChannels.size > 0 ||
      signals.completedChannels.size > 0
    );
  }

  private reason(input: {
    followed: boolean;
    historyAffinity: number;
    likedChannel: boolean;
    completedChannel: boolean;
    relatedChannel: boolean;
    popularity: number;
    recent: number;
    personalized: boolean;
  }): RecommendationReason {
    if (input.relatedChannel) return { code: "RELATED_CHANNEL", label: "More from this creator" };
    if (input.followed) return { code: "FOLLOWED_CHANNEL", label: "From a channel you follow" };
    if (input.likedChannel) return { code: "LIKED_CHANNEL", label: "Because you liked this creator" };
    if (input.completedChannel)
      return { code: "COMPLETED_CHANNEL", label: "Because you finish videos from this creator" };
    if (input.historyAffinity > 0)
      return { code: "CHANNEL_AFFINITY", label: "Because you watch this creator" };
    if (!input.personalized) return { code: "SAFE_FALLBACK", label: "Popular and recent on AYIN" };
    if (input.popularity >= input.recent) return { code: "POPULAR", label: "Popular on AYIN" };
    return { code: "RECENT", label: "Recently published" };
  }

  private toItem(
    video: {
      id: string;
      slug: string;
      title: string;
      channelId: string;
      channel: { handle: string; name: string };
      mediaAssets: Array<{ r2ObjectKey: string }>;
    },
    score: number,
    reason: RecommendationReason,
  ): RecommendationItem {
    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      channelId: video.channelId,
      channelHandle: video.channel.handle,
      channelName: video.channel.name,
      artworkObjectKey: video.mediaAssets[0]?.r2ObjectKey ?? null,
      score,
      reason,
    };
  }

  private async assertVideoExists(videoId: string) {
    const exists = await this.database.client.video.findFirst({
      where: { id: videoId, ...playableVideoWhere },
      select: { id: true },
    });
    if (!exists) throw new RecommendationError("VIDEO_NOT_FOUND", "This video is not available.", 404);
  }
}

export class RecommendationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "RecommendationError";
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function recencyScore(date: Date) {
  const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
  return 1 / (1 + ageDays / 14);
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}
