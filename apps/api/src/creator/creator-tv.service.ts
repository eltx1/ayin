import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { ChannelError, ChannelService } from "./channel.service.js";
import {
  CREATOR_TV_AD_BREAK_HOOK,
  type CreatorTvAdBreakHook,
  type CreatorTvAdBreakMarker,
} from "./creator-tv-ad-break.hook.js";
import {
  buildCreatorTvSchedule,
  orderCreatorTvLibrary,
  type CreatorTvLibraryItem,
  type CreatorTvRotationMode,
} from "./creator-tv.scheduler.js";

const MP4_MIME_TYPE = "video/mp4";
const MAX_GUIDE_PROGRAMS = 96;

export type CreatorTvEditActor =
  | { kind: "owner"; accountId: string }
  | { kind: "admin"; accountId: string };

export interface CreatorTvVideoPreferenceInput {
  included: boolean;
  priority: number;
  sortOrder: number | null;
}

export interface CreatorTvAdminOverrideInput {
  videoId: string;
  startsAt: Date;
  endsAt: Date;
}

export class CreatorTvError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "CreatorTvError";
  }
}

interface TvVideoPayload {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  publishedAt: Date | null;
  durationMs: number | null;
  source: {
    objectKey: string;
    mimeType: string;
  };
  thumbnail: {
    objectKey: string;
    mimeType: string;
  } | null;
}

interface TvProgram {
  occurrenceKey: string;
  source: "AUTO" | "ADMIN";
  video: TvVideoPayload;
  startsAtMs: number;
  endsAtMs: number;
  playbackOffsetMs: number;
}

@Injectable()
export class CreatorTvService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(ChannelService) private readonly channels: ChannelService,
    @Inject(CREATOR_TV_AD_BREAK_HOOK) private readonly adBreakHook: CreatorTvAdBreakHook,
  ) {}

  async getPublicTv(handleRaw: string, now = new Date()) {
    const publicChannel = await this.publicChannel(handleRaw);
    if (!publicChannel.creatorTv) {
      throw new CreatorTvError(
        "CREATOR_TV_NOT_FOUND",
        "This channel's Creator TV is not available.",
        404,
      );
    }

    const tv = await this.database.client.creatorTvChannel.findUnique({
      where: { id: publicChannel.creatorTv.id },
      select: {
        id: true,
        channelId: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
        channel: {
          select: {
            settings: {
              select: {
                autoAddPublishedToTv: true,
                tvAutoScheduleEnabled: true,
              },
            },
          },
        },
      },
    });
    if (!tv) {
      throw new CreatorTvError(
        "CREATOR_TV_NOT_FOUND",
        "This channel's Creator TV is not available.",
        404,
      );
    }

    const policy = await this.getSchedulePolicy();
    const automaticEnabled =
      tv.status === "ACTIVE" &&
      policy.autoAddPublishedUploadsToCreatorTv &&
      (tv.channel.settings?.autoAddPublishedToTv ?? true) &&
      (tv.channel.settings?.tvAutoScheduleEnabled ?? true);

    if (!automaticEnabled) {
      return this.publicOffAirResponse(publicChannel, tv, now, {
        reason:
          tv.status === "DISABLED"
            ? "TV_DISABLED"
            : tv.status === "OFF_AIR"
              ? "TV_OFF_AIR"
              : "AUTOMATIC_SCHEDULING_DISABLED",
        policy,
      });
    }

    const library = await this.loadEligibleLibrary(tv.id, tv.channelId);
    if (library.length === 0) {
      return this.publicOffAirResponse(publicChannel, tv, now, {
        reason: "NO_ELIGIBLE_VIDEOS",
        policy,
      });
    }

    const automatic = buildCreatorTvSchedule({
      epochMs: tv.createdAt.getTime(),
      nowMs: now.getTime(),
      windowMs: policy.guideWindowMs,
      fallbackDurationMs: policy.fallbackDurationMs,
      rotationMode: policy.rotationMode,
      items: library,
      maxPrograms: MAX_GUIDE_PROGRAMS,
    });

    const automaticPrograms = automatic.guide.map<TvProgram>((program) => ({
      occurrenceKey: program.occurrenceKey,
      source: "AUTO",
      video: program.item.payload,
      startsAtMs: program.startsAtMs,
      endsAtMs: program.endsAtMs,
      playbackOffsetMs: 0,
    }));
    const overrides = await this.loadAdminOverrides(
      tv.id,
      now,
      new Date(automatic.windowEndsAtMs),
    );
    const programs = overlayAdminOverrides(automaticPrograms, overrides, now.getTime());
    const currentIndex = programs.findIndex(
      (program) => program.startsAtMs <= now.getTime() && now.getTime() < program.endsAtMs,
    );
    const nowPlaying = currentIndex >= 0 ? (programs[currentIndex] ?? null) : null;
    const upNext = currentIndex >= 0 ? (programs[currentIndex + 1] ?? null) : (programs[0] ?? null);
    const adBreaks = await this.resolveAdBreaks(tv.id, tv.channelId, now, programs);

    return {
      canonicalHandle: publicChannel.canonicalHandle,
      redirectedFrom: publicChannel.redirectedFrom,
      channel: publicChannel.channel,
      appearance: publicChannel.appearance,
      tv: {
        id: tv.id,
        slug: tv.slug,
        name: tv.name,
        status: tv.status,
        state: "ON_AIR" as const,
        offAirReason: null,
      },
      schedule: {
        generatedAt: now,
        windowEndsAt: new Date(automatic.windowEndsAtMs),
        cycleDurationMs: automatic.cycleDurationMs,
        nowPlaying: nowPlaying ? serializeProgram(nowPlaying) : null,
        upNext: upNext ? serializeProgram(upNext) : null,
        guide: programs.map(serializeProgram),
        adBreaks,
      },
      playback: playbackCapability(nowPlaying?.playbackOffsetMs ?? 0),
    };
  }

  async getManagement(actor: CreatorTvEditActor, channelId: string) {
    await this.assertCanManageChannel(actor, channelId);
    const channel = await this.database.client.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        handle: true,
        name: true,
        primaryTvChannel: {
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
          },
        },
        settings: {
          select: {
            autoAddPublishedToTv: true,
            tvAutoScheduleEnabled: true,
          },
        },
      },
    });
    if (!channel?.primaryTvChannel) {
      throw new CreatorTvError("CREATOR_TV_NOT_FOUND", "This Creator TV could not be found.", 404);
    }

    const policy = await this.getSchedulePolicy();
    const library = await this.loadEligibleLibrary(channel.primaryTvChannel.id, channelId, true);
    const ordered = orderCreatorTvLibrary(library, policy.rotationMode);

    return {
      channel: { id: channel.id, handle: channel.handle, name: channel.name },
      tv: channel.primaryTvChannel,
      automation: {
        platformEnabled: policy.autoAddPublishedUploadsToCreatorTv,
        channelAutoAddEnabled: channel.settings?.autoAddPublishedToTv ?? true,
        channelScheduleEnabled: channel.settings?.tvAutoScheduleEnabled ?? true,
        rotationMode: policy.rotationMode,
        fallbackDurationMs: policy.fallbackDurationMs,
        guideWindowMinutes: policy.guideWindowMs / 60_000,
      },
      videos: ordered.map((entry) => {
        const { payloadPreference, ...video } = entry.payload;
        return {
          ...video,
          included: payloadPreference.included,
          priority: entry.priority,
          sortOrder: entry.sortOrder,
          effectiveDurationMs: entry.durationMs ?? policy.fallbackDurationMs,
        };
      }),
    };
  }

  async setVideoPreference(
    actor: CreatorTvEditActor,
    tvChannelId: string,
    videoId: string,
    input: CreatorTvVideoPreferenceInput,
  ) {
    validatePreference(input);
    const tv = await this.getTvForActor(actor, tvChannelId);
    const eligible = await this.findEligibleVideo(videoId, tv.channelId);
    if (!eligible) {
      throw new CreatorTvError(
        "TV_VIDEO_NOT_ELIGIBLE",
        "Choose a published public MP4 from this channel.",
        404,
      );
    }

    const preference = await this.database.client.$transaction(async (tx) => {
      const saved = await tx.creatorTvVideoPreference.upsert({
        where: { tvChannelId_videoId: { tvChannelId, videoId } },
        update: {
          included: input.included,
          priority: input.priority,
          sortOrder: input.sortOrder,
        },
        create: {
          tvChannelId,
          videoId,
          included: input.included,
          priority: input.priority,
          sortOrder: input.sortOrder,
        },
        select: {
          videoId: true,
          included: true,
          priority: true,
          sortOrder: true,
          updatedAt: true,
        },
      });
      await this.auditIfAdmin(tx, actor, "creator_tv.video_preference", tvChannelId, {
        channelId: tv.channelId,
        videoId,
        included: input.included,
        priority: input.priority,
        sortOrder: input.sortOrder,
      });
      return saved;
    });

    return { preference };
  }

  async setAdminEnabled(actor: CreatorTvEditActor, tvChannelId: string, enabled: boolean) {
    await this.assertAdmin(actor);
    const tv = await this.database.client.creatorTvChannel.findUnique({
      where: { id: tvChannelId },
      select: { id: true, channelId: true },
    });
    if (!tv) {
      throw new CreatorTvError("CREATOR_TV_NOT_FOUND", "This Creator TV could not be found.", 404);
    }

    const now = new Date();
    return this.database.client.$transaction(async (tx) => {
      const updated = await tx.creatorTvChannel.update({
        where: { id: tvChannelId },
        data: {
          status: enabled ? "ACTIVE" : "DISABLED",
          disabledAt: enabled ? null : now,
        },
        select: { id: true, channelId: true, status: true, disabledAt: true },
      });
      await this.auditIfAdmin(tx, actor, "creator_tv.enabled", tvChannelId, {
        channelId: tv.channelId,
        enabled,
      });
      return { tv: updated };
    });
  }

  async createAdminOverride(
    actor: CreatorTvEditActor,
    tvChannelId: string,
    input: CreatorTvAdminOverrideInput,
  ) {
    await this.assertAdmin(actor);
    if (!(input.startsAt instanceof Date) || !(input.endsAt instanceof Date)) {
      throw new CreatorTvError("INVALID_TV_OVERRIDE", "Choose a valid override window.");
    }
    if (
      !Number.isFinite(input.startsAt.getTime()) ||
      !Number.isFinite(input.endsAt.getTime()) ||
      input.endsAt.getTime() <= input.startsAt.getTime()
    ) {
      throw new CreatorTvError("INVALID_TV_OVERRIDE", "Override end time must be after its start.");
    }

    const tv = await this.database.client.creatorTvChannel.findUnique({
      where: { id: tvChannelId },
      select: { id: true, channelId: true },
    });
    if (!tv) {
      throw new CreatorTvError("CREATOR_TV_NOT_FOUND", "This Creator TV could not be found.", 404);
    }
    const video = await this.findEligibleVideo(input.videoId, tv.channelId);
    if (!video) {
      throw new CreatorTvError(
        "TV_VIDEO_NOT_ELIGIBLE",
        "Admin schedule overrides require a published public MP4 from this channel.",
        404,
      );
    }

    return this.database.client.$transaction(async (tx) => {
      const item = await tx.tvScheduleItem.create({
        data: {
          tvChannelId,
          videoId: input.videoId,
          source: "ADMIN",
          status: "SCHEDULED",
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        },
        select: {
          id: true,
          tvChannelId: true,
          videoId: true,
          startsAt: true,
          endsAt: true,
          source: true,
          status: true,
        },
      });
      await this.auditIfAdmin(tx, actor, "creator_tv.schedule_override", tvChannelId, {
        channelId: tv.channelId,
        videoId: input.videoId,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
      });
      return { item };
    });
  }

  async cancelAdminOverride(actor: CreatorTvEditActor, scheduleItemId: string) {
    await this.assertAdmin(actor);
    const current = await this.database.client.tvScheduleItem.findFirst({
      where: { id: scheduleItemId, source: "ADMIN" },
      select: { id: true, tvChannelId: true, tvChannel: { select: { channelId: true } } },
    });
    if (!current) {
      throw new CreatorTvError("TV_OVERRIDE_NOT_FOUND", "This TV override could not be found.", 404);
    }

    return this.database.client.$transaction(async (tx) => {
      const item = await tx.tvScheduleItem.update({
        where: { id: scheduleItemId },
        data: { status: "CANCELLED" },
        select: { id: true, status: true },
      });
      await this.auditIfAdmin(tx, actor, "creator_tv.schedule_override_cancel", current.tvChannelId, {
        channelId: current.tvChannel.channelId,
        scheduleItemId,
      });
      return { item };
    });
  }

  private async publicChannel(handleRaw: string) {
    try {
      return await this.channels.getPublicChannel(handleRaw);
    } catch (error) {
      if (error instanceof ChannelError) {
        throw new CreatorTvError(error.code, error.message, error.statusCode);
      }
      throw error;
    }
  }

  private async getSchedulePolicy() {
    const [autoAdd, fallbackDurationMs, guideWindowMinutes, rotationMode] = await Promise.all([
      this.settings.get("autoAddPublishedUploadsToCreatorTv"),
      this.settings.get("creatorTvFallbackProgramDurationMs"),
      this.settings.get("creatorTvGuideWindowMinutes"),
      this.settings.get("creatorTvRotationMode"),
    ]);
    return {
      autoAddPublishedUploadsToCreatorTv: autoAdd as boolean,
      fallbackDurationMs: fallbackDurationMs as number,
      guideWindowMs: (guideWindowMinutes as number) * 60_000,
      rotationMode: rotationMode as CreatorTvRotationMode,
    };
  }

  private async loadEligibleLibrary(
    tvChannelId: string,
    channelId: string,
    includeExcluded = false,
  ): Promise<Array<CreatorTvLibraryItem<TvVideoPayload & { payloadPreference: CreatorTvVideoPreferenceInput }>>> {
    const videos = await this.database.client.video.findMany({
      where: {
        channelId,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        removedAt: null,
        mediaAssets: {
          some: {
            kind: "SOURCE_VIDEO",
            status: { in: ["UPLOADED", "VALIDATED"] },
            removedAt: null,
            mimeType: MP4_MIME_TYPE,
          },
        },
      },
      orderBy: [{ publishedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        durationMs: true,
        publishedAt: true,
        createdAt: true,
        mediaAssets: {
          where: {
            kind: { in: ["SOURCE_VIDEO", "THUMBNAIL"] },
            status: { in: ["UPLOADED", "VALIDATED"] },
            removedAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: {
            kind: true,
            r2ObjectKey: true,
            mimeType: true,
            durationMs: true,
          },
        },
        tvPreferences: {
          where: { tvChannelId },
          take: 1,
          select: { included: true, priority: true, sortOrder: true },
        },
      },
    });

    return videos.flatMap((video) => {
      const source = video.mediaAssets.find(
        (asset) => asset.kind === "SOURCE_VIDEO" && asset.mimeType === MP4_MIME_TYPE,
      );
      if (!source) return [];
      const thumbnail = video.mediaAssets.find((asset) => asset.kind === "THUMBNAIL") ?? null;
      const preference = video.tvPreferences[0] ?? {
        included: true,
        priority: 0,
        sortOrder: null,
      };
      if (!includeExcluded && !preference.included) return [];

      return [
        {
          id: video.id,
          durationMs: video.durationMs ?? source.durationMs,
          priority: preference.priority,
          sortOrder: preference.sortOrder,
          publishedAtMs: (video.publishedAt ?? video.createdAt).getTime(),
          payload: {
            id: video.id,
            slug: video.slug,
            title: video.title,
            description: video.description,
            publishedAt: video.publishedAt,
            durationMs: video.durationMs ?? source.durationMs,
            source: {
              objectKey: source.r2ObjectKey,
              mimeType: source.mimeType,
            },
            thumbnail: thumbnail
              ? { objectKey: thumbnail.r2ObjectKey, mimeType: thumbnail.mimeType }
              : null,
            payloadPreference: {
              included: preference.included,
              priority: preference.priority,
              sortOrder: preference.sortOrder,
            },
          },
        },
      ];
    });
  }

  private async findEligibleVideo(videoId: string, channelId: string) {
    return this.database.client.video.findFirst({
      where: {
        id: videoId,
        channelId,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        removedAt: null,
        mediaAssets: {
          some: {
            kind: "SOURCE_VIDEO",
            status: { in: ["UPLOADED", "VALIDATED"] },
            removedAt: null,
            mimeType: MP4_MIME_TYPE,
          },
        },
      },
      select: { id: true },
    });
  }

  private async loadAdminOverrides(tvChannelId: string, from: Date, until: Date): Promise<TvProgram[]> {
    const items = await this.database.client.tvScheduleItem.findMany({
      where: {
        tvChannelId,
        source: "ADMIN",
        status: { in: ["SCHEDULED", "ACTIVE"] },
        startsAt: { lt: until },
        endsAt: { gt: from },
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        video: {
          select: {
            id: true,
            slug: true,
            title: true,
            description: true,
            durationMs: true,
            publishedAt: true,
            mediaAssets: {
              where: {
                kind: { in: ["SOURCE_VIDEO", "THUMBNAIL"] },
                status: { in: ["UPLOADED", "VALIDATED"] },
                removedAt: null,
              },
              orderBy: { createdAt: "desc" },
              select: {
                kind: true,
                r2ObjectKey: true,
                mimeType: true,
                durationMs: true,
              },
            },
          },
        },
      },
    });

    return items.flatMap((item) => {
      const source = item.video.mediaAssets.find(
        (asset) => asset.kind === "SOURCE_VIDEO" && asset.mimeType === MP4_MIME_TYPE,
      );
      if (!source) return [];
      const thumbnail = item.video.mediaAssets.find((asset) => asset.kind === "THUMBNAIL") ?? null;
      return [
        {
          occurrenceKey: `admin:${item.id}`,
          source: "ADMIN" as const,
          video: {
            id: item.video.id,
            slug: item.video.slug,
            title: item.video.title,
            description: item.video.description,
            publishedAt: item.video.publishedAt,
            durationMs: item.video.durationMs ?? source.durationMs,
            source: { objectKey: source.r2ObjectKey, mimeType: source.mimeType },
            thumbnail: thumbnail
              ? { objectKey: thumbnail.r2ObjectKey, mimeType: thumbnail.mimeType }
              : null,
          },
          startsAtMs: item.startsAt.getTime(),
          endsAtMs: item.endsAt.getTime(),
          playbackOffsetMs: 0,
        },
      ];
    });
  }

  private publicOffAirResponse(
    publicChannel: Awaited<ReturnType<ChannelService["getPublicChannel"]>>,
    tv: { id: string; slug: string; name: string; status: "ACTIVE" | "OFF_AIR" | "DISABLED" },
    now: Date,
    input: {
      reason:
        | "TV_DISABLED"
        | "TV_OFF_AIR"
        | "AUTOMATIC_SCHEDULING_DISABLED"
        | "NO_ELIGIBLE_VIDEOS";
      policy: Awaited<ReturnType<CreatorTvService["getSchedulePolicy"]>>;
    },
  ) {
    return {
      canonicalHandle: publicChannel.canonicalHandle,
      redirectedFrom: publicChannel.redirectedFrom,
      channel: publicChannel.channel,
      appearance: publicChannel.appearance,
      tv: {
        id: tv.id,
        slug: tv.slug,
        name: tv.name,
        status: tv.status,
        state: "OFF_AIR" as const,
        offAirReason: input.reason,
      },
      schedule: {
        generatedAt: now,
        windowEndsAt: new Date(now.getTime() + input.policy.guideWindowMs),
        cycleDurationMs: 0,
        nowPlaying: null,
        upNext: null,
        guide: [],
        adBreaks: [] as CreatorTvAdBreakMarker[],
      },
      playback: playbackCapability(0),
    };
  }

  private async resolveAdBreaks(
    tvChannelId: string,
    channelId: string,
    generatedAt: Date,
    programs: TvProgram[],
  ) {
    return this.adBreakHook.getBreaks({
      tvChannelId,
      channelId,
      generatedAt,
      programs: programs.map((program) => ({
        occurrenceKey: program.occurrenceKey,
        videoId: program.video.id,
        startsAt: new Date(program.startsAtMs),
        endsAt: new Date(program.endsAtMs),
      })),
    });
  }

  private async getTvForActor(actor: CreatorTvEditActor, tvChannelId: string) {
    const tv = await this.database.client.creatorTvChannel.findUnique({
      where: { id: tvChannelId },
      select: { id: true, channelId: true },
    });
    if (!tv) {
      throw new CreatorTvError("CREATOR_TV_NOT_FOUND", "This Creator TV could not be found.", 404);
    }
    await this.assertCanManageChannel(actor, tv.channelId);
    return tv;
  }

  private async assertCanManageChannel(actor: CreatorTvEditActor, channelId: string): Promise<void> {
    if (actor.kind === "owner") {
      const membership = await this.database.client.channelMember.findFirst({
        where: { accountId: actor.accountId, channelId, role: "OWNER" },
        select: { id: true },
      });
      if (!membership) {
        throw new CreatorTvError(
          "CHANNEL_OWNER_REQUIRED",
          "Only the channel owner can manage Creator TV.",
          403,
        );
      }
      return;
    }
    await this.assertAdmin(actor);
  }

  private async assertAdmin(actor: CreatorTvEditActor): Promise<void> {
    if (actor.kind !== "admin") {
      throw new CreatorTvError("ADMIN_REQUIRED", "An AYIN admin role is required.", 403);
    }
    const assignment = await this.database.client.adminRoleAssignment.findFirst({
      where: {
        accountId: actor.accountId,
        role: { in: ["ADMIN", "SUPERADMIN"] },
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new CreatorTvError("ADMIN_REQUIRED", "An AYIN admin role is required.", 403);
    }
  }

  private async auditIfAdmin(
    tx: Prisma.TransactionClient,
    actor: CreatorTvEditActor,
    action: string,
    entityId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    if (actor.kind !== "admin") return;
    await tx.adminAuditLog.create({
      data: {
        actorAccountId: actor.accountId,
        action,
        entityType: "CreatorTvChannel",
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}

function validatePreference(input: CreatorTvVideoPreferenceInput): void {
  if (!Number.isSafeInteger(input.priority) || input.priority < -100000 || input.priority > 100000) {
    throw new CreatorTvError(
      "INVALID_TV_PRIORITY",
      "Creator TV priority must be a whole number between -100000 and 100000.",
    );
  }
  if (
    input.sortOrder !== null &&
    (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 1000000)
  ) {
    throw new CreatorTvError(
      "INVALID_TV_ORDER",
      "Creator TV order must be blank or a whole number between 0 and 1000000.",
    );
  }
}

function overlayAdminOverrides(
  automatic: TvProgram[],
  overrides: TvProgram[],
  nowMs: number,
): TvProgram[] {
  let programs = automatic.map((program) => ({ ...program }));

  for (const override of overrides) {
    const next: TvProgram[] = [];
    for (const program of programs) {
      if (program.endsAtMs <= override.startsAtMs || program.startsAtMs >= override.endsAtMs) {
        next.push(program);
        continue;
      }

      if (program.startsAtMs < override.startsAtMs) {
        next.push({ ...program, endsAtMs: override.startsAtMs });
      }
      if (program.endsAtMs > override.endsAtMs) {
        next.push({
          ...program,
          occurrenceKey: `${program.occurrenceKey}:resume:${override.occurrenceKey}`,
          startsAtMs: override.endsAtMs,
          playbackOffsetMs: program.playbackOffsetMs + (override.endsAtMs - program.startsAtMs),
        });
      }
    }
    next.push({ ...override });
    programs = next.sort((left, right) => {
      if (left.startsAtMs !== right.startsAtMs) return left.startsAtMs - right.startsAtMs;
      return left.source === "ADMIN" ? -1 : 1;
    });
  }

  return programs
    .filter((program) => program.endsAtMs > nowMs)
    .map((program) => ({
      ...program,
      playbackOffsetMs:
        program.startsAtMs <= nowMs && nowMs < program.endsAtMs
          ? program.playbackOffsetMs + (nowMs - program.startsAtMs)
          : program.playbackOffsetMs,
    }));
}

function serializeProgram(program: TvProgram) {
  return {
    occurrenceKey: program.occurrenceKey,
    source: program.source,
    video: program.video,
    startsAt: new Date(program.startsAtMs),
    endsAt: new Date(program.endsAtMs),
    playbackOffsetMs: program.playbackOffsetMs,
  };
}

function playbackCapability(offsetMs: number) {
  return {
    exactMidProgramSynchronization: false,
    strategy: "BEST_EFFORT_PROGRESSIVE_MP4" as const,
    conceptualOffsetMs: Math.max(0, offsetMs),
    limitation:
      "Creator TV V1 calculates the wall-clock program and offset exactly, but progressive MP4/browser seeking and autoplay cannot guarantee frame-accurate synchronized mid-file starts across viewers.",
  };
}
