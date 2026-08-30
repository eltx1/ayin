import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";

import { DatabaseService } from "../database/database.service.js";
import type { AnalyticsEventInput } from "./analytics.schemas.js";

const DAY_MS = 86_400_000;

function clampDate(date: Date) {
  const now = Date.now();
  const min = now - 7 * DAY_MS;
  const max = now + 5 * 60_000;
  return new Date(Math.min(Math.max(date.getTime(), min), max));
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ingest(events: AnalyticsEventInput[]) {
    const videoIds = [
      ...new Set(events.flatMap((event) => (event.videoId ? [event.videoId] : []))),
    ];
    const videos = videoIds.length
      ? await this.database.client.video.findMany({
          where: { id: { in: videoIds } },
          select: { id: true, channelId: true },
        })
      : [];
    const videoChannels = new Map(videos.map((video) => [video.id, video.channelId]));
    const validChannelIds = new Set(
      (
        await this.database.client.channel.findMany({
          where: {
            id: {
              in: [
                ...new Set(events.flatMap((event) => (event.channelId ? [event.channelId] : []))),
              ],
            },
          },
          select: { id: true },
        })
      ).map((channel) => channel.id),
    );

    const data: Prisma.AnalyticsEventCreateManyInput[] = [];
    for (const event of events) {
      if (event.videoId && !videoChannels.has(event.videoId)) continue;
      const derivedChannelId = event.videoId ? videoChannels.get(event.videoId) : event.channelId;
      if (
        derivedChannelId &&
        !videoChannels.has(event.videoId ?? "") &&
        !validChannelIds.has(derivedChannelId)
      ) {
        continue;
      }
      data.push({
        clientEventId: event.clientEventId,
        schemaVersion: event.schemaVersion,
        eventName: event.eventName,
        occurredAt: clampDate(new Date(event.occurredAt)),
        sessionHash: this.pseudonym(event.sessionId),
        ...(event.profileId ? { profileHash: this.pseudonym(event.profileId) } : {}),
        ...(derivedChannelId ? { channelId: derivedChannelId } : {}),
        ...(event.videoId ? { videoId: event.videoId } : {}),
        source: event.source,
        ...(event.deviceClass ? { deviceClass: event.deviceClass } : {}),
        ...(event.durationDeltaMs !== undefined && event.durationDeltaMs !== null
          ? { durationDeltaMs: event.durationDeltaMs }
          : {}),
        ...(event.positionMs !== undefined && event.positionMs !== null
          ? { positionMs: event.positionMs }
          : {}),
        ...(event.metadata ? { metadata: event.metadata as Prisma.InputJsonValue } : {}),
      });
    }

    if (!data.length) return { accepted: 0, duplicateOrInvalid: events.length };
    const result = await this.database.client.analyticsEvent.createMany({
      data,
      skipDuplicates: true,
    });
    return { accepted: result.count, duplicateOrInvalid: events.length - result.count };
  }

  async creatorMetrics(accountId: string, days = 28) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN", "EDITOR"] },
        channel: { status: { not: "REMOVED" } },
      },
      orderBy: { createdAt: "asc" },
      select: { channelId: true },
    });
    if (!membership) return null;
    return this.channelMetrics(membership.channelId, days);
  }

  async channelMetrics(channelId: string, days = 28) {
    const since = new Date(Date.now() - Math.max(1, Math.min(days, 365)) * DAY_MS);
    const where = { channelId, occurredAt: { gte: since } };
    const [views, completes, watch, subscribers, videoGroups] = await Promise.all([
      this.database.client.analyticsEvent.count({ where: { ...where, eventName: "VIDEO_START" } }),
      this.database.client.analyticsEvent.count({
        where: { ...where, eventName: "VIDEO_COMPLETE" },
      }),
      this.database.client.analyticsEvent.aggregate({
        where: { ...where, eventName: "VIDEO_PROGRESS" },
        _sum: { durationDeltaMs: true },
      }),
      this.database.client.subscription.count({ where: { channelId } }),
      this.database.client.analyticsEvent.groupBy({
        by: ["videoId"],
        where: { ...where, eventName: "VIDEO_START", videoId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { videoId: "desc" } },
        take: 10,
      }),
    ]);
    const videoIds = videoGroups.flatMap((group) => (group.videoId ? [group.videoId] : []));
    const titles = new Map(
      (
        await this.database.client.video.findMany({
          where: { id: { in: videoIds } },
          select: { id: true, title: true },
        })
      ).map((video) => [video.id, video.title]),
    );
    const watchTimeMs = watch._sum.durationDeltaMs ?? 0;
    return {
      periodDays: Math.max(1, Math.min(days, 365)),
      refresh: "query-time",
      views,
      watchTimeMs,
      averageViewDurationMs: views > 0 ? Math.round(watchTimeMs / views) : 0,
      completionRate: views > 0 ? completes / views : 0,
      subscribers,
      topVideos: videoGroups.map((group) => ({
        videoId: group.videoId as string,
        title: titles.get(group.videoId as string) ?? "Untitled video",
        views: group._count._all,
      })),
    };
  }

  async adminMetrics() {
    const now = Date.now();
    const day = new Date(now - DAY_MS);
    const month = new Date(now - 30 * DAY_MS);
    const [dailySessions, monthlySessions, watch, uploads, tvStarts, adEvents, errors] =
      await Promise.all([
        this.database.client.analyticsEvent.findMany({
          where: { occurredAt: { gte: day } },
          distinct: ["sessionHash"],
          select: { sessionHash: true },
        }),
        this.database.client.analyticsEvent.findMany({
          where: { occurredAt: { gte: month } },
          distinct: ["sessionHash"],
          select: { sessionHash: true },
        }),
        this.database.client.analyticsEvent.aggregate({
          where: { occurredAt: { gte: month }, eventName: "VIDEO_PROGRESS" },
          _sum: { durationDeltaMs: true },
        }),
        this.database.client.analyticsEvent.count({
          where: { occurredAt: { gte: month }, eventName: { in: ["UPLOAD_COMPLETE", "PUBLISH"] } },
        }),
        this.database.client.analyticsEvent.count({
          where: { occurredAt: { gte: month }, eventName: "TV_START" },
        }),
        this.database.client.analyticsEvent.count({
          where: {
            occurredAt: { gte: month },
            eventName: {
              in: ["AD_REQUEST", "AD_START", "AD_QUARTILE", "AD_COMPLETE", "AD_CLICK", "AD_ERROR"],
            },
          },
        }),
        this.database.client.analyticsEvent.count({
          where: { occurredAt: { gte: month }, eventName: { in: ["AD_ERROR", "VIDEO_BUFFER"] } },
        }),
      ]);
    const watchTimeMs = watch._sum.durationDeltaMs ?? 0;
    return {
      refresh: "query-time",
      dauApprox: dailySessions.length,
      mauApprox: monthlySessions.length,
      watchTimeMs,
      watchHours: watchTimeMs / 3_600_000,
      uploads,
      tvStarts,
      adEvents,
      errors,
    };
  }

  async deleteExpired(retentionDays = 400) {
    const days = Math.max(30, Math.min(retentionDays, 3650));
    const before = new Date(Date.now() - days * DAY_MS);
    const result = await this.database.client.analyticsEvent.deleteMany({
      where: { occurredAt: { lt: before } },
    });
    return { deleted: result.count, before, retentionDays: days };
  }

  private pseudonym(value: string) {
    const salt =
      process.env.ANALYTICS_HASH_SALT ?? process.env.AUTH_TOKEN_SECRET ?? "ayin-local-analytics-v1";
    return createHmac("sha256", salt).update(value).digest("hex");
  }
}
