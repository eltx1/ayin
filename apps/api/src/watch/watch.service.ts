import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { FeatureFlagService } from "../platform-config/feature-flag.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";

const playableStates = ["VALIDATED"] as const;
const HLS_PLAYBACK_FLAG = "player.hls.enabled";

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
    @Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService,
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

    const hlsPlaybackEnabled = await this.featureFlags.isEnabled(HLS_PLAYBACK_FLAG);
    const playbackGeneration = hlsPlaybackEnabled
      ? await this.database.client.mediaPlaybackGeneration.findFirst({
          where: {
            videoId: video.id,
            status: "READY",
            fallbackStatus: "READY",
            hlsMasterStatus: "READY",
            renditions: { some: { status: "READY", protocol: "HLS" } },
          },
          orderBy: { generation: "desc" },
          select: {
            fallbackR2ObjectKey: true,
            hlsMasterR2ObjectKey: true,
            renditions: {
              where: { status: "READY", protocol: "HLS" },
              orderBy: [{ height: "asc" }, { videoBitrateKbps: "asc" }],
              select: {
                identity: true,
                width: true,
                height: true,
                videoBitrateKbps: true,
                audioBitrateKbps: true,
              },
            },
          },
        })
      : null;

    const [captionTracks, creatorMetadata] = await Promise.all([
      this.database.client.videoCaptionTrack.findMany({
        where: { videoId: video.id, isEnabled: true, mediaAssetId: { not: null } },
        orderBy: [{ isDefault: "desc" }, { languageCode: "asc" }, { createdAt: "asc" }],
      }),
      this.database.client.videoCreatorMetadata.findUnique({
        where: { videoId: video.id },
        select: { chapters: true },
      }),
    ]);
    const captionAssets = new Map(
      video.mediaAssets
        .filter((asset) => asset.kind === "CAPTION")
        .map((asset) => [asset.id, asset]),
    );
    const captions = captionTracks.flatMap((track) => {
      if (!track.mediaAssetId) return [];
      const asset = captionAssets.get(track.mediaAssetId);
      if (!asset || asset.mimeType !== "text/vtt") return [];
      return [
        {
          id: track.id,
          objectKey: asset.r2ObjectKey,
          mimeType: "text/vtt" as const,
          label: track.label,
          language: track.languageCode,
          kind: track.kind,
          default: track.isDefault,
        },
      ];
    });
    const playbackDurationMs = video.durationMs ?? source.durationMs;
    const chapters = playableChapters(creatorMetadata?.chapters, playbackDurationMs);

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

    const adaptiveSource =
      playbackGeneration && playbackGeneration.renditions.length > 0
        ? {
            objectKey: playbackGeneration.hlsMasterR2ObjectKey,
            mimeType: "application/vnd.apple.mpegurl" as const,
            renditions: playbackGeneration.renditions.map((rendition) => ({
              id: rendition.identity,
              label: `${rendition.height}p`,
              width: rendition.width,
              height: rendition.height,
              bitrateKbps: rendition.videoBitrateKbps + rendition.audioBitrateKbps,
            })),
          }
        : null;

    return {
      video: {
        id: video.id,
        slug: video.slug,
        title: video.title,
        description: video.description,
        durationMs: playbackDurationMs,
        publishedAt: video.publishedAt,
        channel: {
          id: video.channel.id,
          handle: video.channel.handle,
          name: video.channel.name,
        },
        source: {
          objectKey: playbackGeneration?.fallbackR2ObjectKey ?? source.r2ObjectKey,
          mimeType: "video/mp4",
        },
        adaptiveSource,
        captions,
        chapters,
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

function playableChapters(value: unknown, durationMs: number | null) {
  if (!Array.isArray(value)) return [];
  const result: Array<{ id: string; title: string; startMs: number }> = [];
  let previousStartMs = -1;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const startSeconds = record.startSeconds;
    if (
      !title ||
      title.length > 100 ||
      typeof startSeconds !== "number" ||
      !Number.isInteger(startSeconds) ||
      startSeconds < 0
    ) {
      continue;
    }
    const startMs = startSeconds * 1000;
    if (startMs <= previousStartMs) continue;
    if (durationMs && durationMs > 0 && startMs >= durationMs) continue;
    result.push({ id: `chapter-${index}-${startMs}`, title, startMs });
    previousStartMs = startMs;
  }
  return result;
}
