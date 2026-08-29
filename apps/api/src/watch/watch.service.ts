import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";

const playableStates = ["UPLOADED", "VALIDATED"] as const;

export class WatchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "WatchError";
  }
}

export interface SaveWatchProgressInput {
  profileId?: string | undefined;
  positionMs: number;
  durationMs?: number | undefined;
}

@Injectable()
export class WatchService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async getPublicPlayback(slug: string) {
    const video = await this.database.client.video.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        commentsEnabled: true,
        durationMs: true,
        publishedAt: true,
        status: true,
        visibility: true,
        removedAt: true,
        channel: {
          select: { id: true, handle: true, name: true, status: true, removedAt: true },
        },
        mediaAssets: {
          where: { removedAt: null, status: { in: [...playableStates] } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            kind: true,
            mimeType: true,
            r2ObjectKey: true,
            durationMs: true,
          },
        },
      },
    });

    if (
      !video ||
      video.status !== "PUBLISHED" ||
      video.visibility === "PRIVATE" ||
      video.removedAt ||
      video.channel.status !== "ACTIVE" ||
      video.channel.removedAt
    ) {
      throw new WatchError("VIDEO_NOT_FOUND", "This AYIN video could not be found.", 404);
    }

    const source = video.mediaAssets.find(
      (asset) => asset.kind === "SOURCE_VIDEO" && asset.mimeType === "video/mp4",
    );
    if (!source) {
      throw new WatchError(
        "VIDEO_NOT_PLAYABLE",
        "This video does not have a playable MP4 source available.",
        409,
      );
    }

    const captions = video.mediaAssets
      .filter(
        (asset) =>
          asset.kind === "CAPTION" &&
          (asset.mimeType === "text/vtt" || asset.mimeType === "application/vtt"),
      )
      .map((asset, index) => ({
        id: asset.id,
        objectKey: asset.r2ObjectKey,
        mimeType: asset.mimeType,
        label: index === 0 ? "Captions" : `Captions ${index + 1}`,
        language: "und",
        default: index === 0,
      }));

    const related = await this.database.client.video.findMany({
      where: {
        id: { not: video.id },
        channelId: video.channel.id,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        mediaAssets: {
          some: {
            kind: "SOURCE_VIDEO",
            status: { in: [...playableStates] },
            removedAt: null,
            mimeType: "video/mp4",
          },
        },
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 8,
      select: { id: true, slug: true, title: true, durationMs: true },
    });

    return {
      video: {
        id: video.id,
        slug: video.slug,
        title: video.title,
        description: video.description,
        durationMs: video.durationMs ?? source.durationMs,
        publishedAt: video.publishedAt,
        channel: {
          id: video.channel.id,
          handle: video.channel.handle,
          name: video.channel.name,
        },
        source: {
          objectKey: source.r2ObjectKey,
          mimeType: source.mimeType,
        },
        captions,
        chapters: [],
      },
      detail: {
        contentType: "CREATOR_VIDEO" as const,
        saveHook: { action: "WATCH_LATER" as const, available: true },
        commentsSlot: { reserved: true, enabled: video.commentsEnabled },
        externalAdPlacementKeys: ["watch_below_player", "content_detail"],
        related: related.map((item) => ({
          id: item.id,
          title: item.title,
          href: `/watch/${item.slug}`,
          durationMs: item.durationMs,
        })),
      },
      playerPolicy: await this.getPlayerPolicy(),
    };
  }

  async getProgress(accountId: string, videoId: string, profileId?: string) {
    const profile = await this.resolveProfile(accountId, profileId);
    await this.assertPlayableVideo(videoId);
    const progress = await this.database.client.watchProgress.findUnique({
      where: { profileId_videoId: { profileId: profile.id, videoId } },
      select: {
        positionMs: true,
        completedAt: true,
        lastWatchedAt: true,
      },
    });

    return {
      profileId: profile.id,
      videoId,
      positionMs: progress?.positionMs ?? 0,
      completedAt: progress?.completedAt ?? null,
      lastWatchedAt: progress?.lastWatchedAt ?? null,
      policy: await this.getPlayerPolicy(),
    };
  }

  async saveProgress(accountId: string, videoId: string, input: SaveWatchProgressInput) {
    const [profile, video, policy] = await Promise.all([
      this.resolveProfile(accountId, input.profileId),
      this.findPlayableVideo(videoId),
      this.getPlayerPolicy(),
    ]);

    const sourceDurationMs = video.mediaAssets[0]?.durationMs ?? null;
    const knownDurationMs = video.durationMs ?? sourceDurationMs ?? input.durationMs ?? null;
    const rawPositionMs = Math.max(0, Math.floor(input.positionMs));
    const positionMs =
      knownDurationMs && knownDurationMs > 0
        ? Math.min(rawPositionMs, knownDurationMs)
        : rawPositionMs;
    const completed =
      knownDurationMs !== null &&
      knownDurationMs > 0 &&
      positionMs / knownDurationMs >= policy.completionThresholdPercent / 100;
    const now = new Date();

    const progress = await this.database.client.$transaction(async (tx) => {
      const saved = await tx.watchProgress.upsert({
        where: { profileId_videoId: { profileId: profile.id, videoId } },
        create: {
          profileId: profile.id,
          videoId,
          positionMs,
          lastWatchedAt: now,
          completedAt: completed ? now : null,
        },
        update: {
          positionMs,
          lastWatchedAt: now,
          completedAt: completed ? now : null,
        },
        select: {
          positionMs: true,
          completedAt: true,
          lastWatchedAt: true,
        },
      });

      await tx.watchHistory.upsert({
        where: { profileId_videoId: { profileId: profile.id, videoId } },
        create: {
          profileId: profile.id,
          videoId,
          firstWatchedAt: now,
          lastWatchedAt: now,
          viewCount: 1,
        },
        update: { lastWatchedAt: now },
      });
      return saved;
    });

    return {
      profileId: profile.id,
      videoId,
      positionMs: progress.positionMs,
      completedAt: progress.completedAt,
      lastWatchedAt: progress.lastWatchedAt,
      completed,
      policy,
    };
  }

  async getPlayerPolicy() {
    const [saveIntervalSeconds, completionThresholdPercent] = await Promise.all([
      this.settings.get("watchProgressSaveIntervalSeconds"),
      this.settings.get("watchCompletionThresholdPercent"),
    ]);
    return {
      progressSaveIntervalMs: (saveIntervalSeconds as number) * 1000,
      completionThresholdPercent: completionThresholdPercent as number,
    };
  }

  private async resolveProfile(accountId: string, requestedProfileId?: string) {
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

    if (!profile) {
      throw new WatchError(
        "VIEWER_PROFILE_NOT_FOUND",
        "This viewer profile is not available for the signed-in account.",
        403,
      );
    }
    return profile;
  }

  private async assertPlayableVideo(videoId: string): Promise<void> {
    await this.findPlayableVideo(videoId);
  }

  private async findPlayableVideo(videoId: string) {
    const video = await this.database.client.video.findFirst({
      where: {
        id: videoId,
        status: "PUBLISHED",
        visibility: { in: ["PUBLIC", "UNLISTED"] },
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
      },
      select: {
        id: true,
        durationMs: true,
        mediaAssets: {
          where: {
            kind: "SOURCE_VIDEO",
            status: { in: [...playableStates] },
            removedAt: null,
            mimeType: "video/mp4",
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { durationMs: true },
        },
      },
    });
    if (!video) {
      throw new WatchError("VIDEO_NOT_FOUND", "This AYIN video could not be found.", 404);
    }
    return video;
  }
}
