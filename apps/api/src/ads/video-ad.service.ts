import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { resolveVideoAdPolicy } from "./video-ad-policy.js";

export const videoAdSettingsSchema = z.object({
  masterEnabled: z.boolean(),
  provider: z.enum(["GOOGLE_IMA"]),
  preRollEnabled: z.boolean(),
  midRollEnabled: z.boolean(),
  postRollEnabled: z.boolean(),
  midRollEverySec: z.number().int().min(60).max(7200),
  frequencyCapPerSession: z.number().int().min(0).max(50),
  externalVastTagUrl: z.string().url().max(4096).nullable(),
  houseCreativeUrl: z.string().url().max(4096).nullable(),
  houseClickUrl: z.string().url().max(4096).nullable(),
});

export type VideoAdSettings = z.infer<typeof videoAdSettingsSchema>;

export const defaultVideoAdSettings: VideoAdSettings = {
  masterEnabled: false,
  provider: "GOOGLE_IMA",
  preRollEnabled: true,
  midRollEnabled: false,
  postRollEnabled: false,
  midRollEverySec: 600,
  frequencyCapPerSession: 3,
  externalVastTagUrl: null,
  houseCreativeUrl: null,
  houseClickUrl: null,
};

export const overrideSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  preRollEnabled: z.boolean().nullable().optional(),
  midRollEnabled: z.boolean().nullable().optional(),
  postRollEnabled: z.boolean().nullable().optional(),
  provider: z.enum(["GOOGLE_IMA"]).nullable().optional(),
  vastTagUrl: z.string().url().max(4096).nullable().optional(),
  midRollEverySec: z.number().int().min(60).max(7200).nullable().optional(),
});

type VideoAdOverrideInput = z.infer<typeof overrideSchema>;

export const adEventSchema = z.object({
  videoId: z.string().uuid(),
  slot: z.enum(["PRE_ROLL", "MID_ROLL", "POST_ROLL"]),
  eventType: z.enum([
    "REQUEST",
    "FILL",
    "IMPRESSION",
    "START",
    "QUARTILE_25",
    "MIDPOINT",
    "QUARTILE_75",
    "COMPLETE",
    "CLICK",
    "ERROR",
  ]),
  requestId: z.string().trim().min(1).max(120).nullable().optional(),
  sessionId: z.string().trim().min(1).max(120).nullable().optional(),
  provider: z.enum(["GOOGLE_IMA"]),
  errorCode: z.string().trim().max(120).nullable().optional(),
});

export type VideoAdEventInput = z.infer<typeof adEventSchema>;

@Injectable()
export class VideoAdService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async getSettings(): Promise<VideoAdSettings> {
    const row = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "videoAdsV1" } },
      select: { value: true },
    });
    const parsed = videoAdSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : defaultVideoAdSettings;
  }

  async updateSettings(actorAccountId: string, input: unknown): Promise<VideoAdSettings> {
    const settings = videoAdSettingsSchema.parse(input);
    const value = settings as unknown as Prisma.InputJsonValue;
    return this.database.client.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { namespace_key: { namespace: "ADVERTISING", key: "videoAdsV1" } },
        update: { value, valueType: "JSON", schemaVersion: 1 },
        create: {
          namespace: "ADVERTISING",
          key: "videoAdsV1",
          valueType: "JSON",
          value,
          schemaVersion: 1,
          description: "Task 19 typed in-player video advertising defaults.",
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "VIDEO_AD_SETTINGS_UPDATED",
        entityType: "PlatformSetting",
        entityId: "ADVERTISING/videoAdsV1",
        metadata: {
          masterEnabled: settings.masterEnabled,
          preRollEnabled: settings.preRollEnabled,
          midRollEnabled: settings.midRollEnabled,
          postRollEnabled: settings.postRollEnabled,
          frequencyCapPerSession: settings.frequencyCapPerSession,
        },
      });
      return settings;
    });
  }

  async listOverrides() {
    const rows = await this.database.client.videoAdOverride.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    const channelIds = rows.flatMap((row) => (row.channelId ? [row.channelId] : []));
    const videoIds = rows.flatMap((row) => (row.videoId ? [row.videoId] : []));
    const [channels, videos] = await Promise.all([
      channelIds.length
        ? this.database.client.channel.findMany({
            where: { id: { in: channelIds } },
            select: { id: true, name: true, handle: true, status: true },
          })
        : Promise.resolve([]),
      videoIds.length
        ? this.database.client.video.findMany({
            where: { id: { in: videoIds } },
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              channel: { select: { id: true, name: true, handle: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const channelsById = new Map(channels.map((item) => [item.id, item]));
    const videosById = new Map(videos.map((item) => [item.id, item]));
    return rows.map((row) => ({
      ...row,
      channel: row.channelId ? (channelsById.get(row.channelId) ?? null) : null,
      video: row.videoId ? (videosById.get(row.videoId) ?? null) : null,
    }));
  }

  async getDecision(videoId: string, origin: string | null) {
    const killSwitch = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "emergencyKillSwitch" } },
      select: { value: true },
    });
    if (killSwitch?.value === true) {
      return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" as const };
    }

    const video = await this.database.client.video.findFirst({
      where: { id: videoId, status: "PUBLISHED", visibility: { in: ["PUBLIC", "UNLISTED"] } },
      select: { id: true, channelId: true, durationMs: true },
    });
    if (!video) return { enabled: false, reason: "VIDEO_NOT_ELIGIBLE" as const };

    const [settings, channelOverride, videoOverride] = await Promise.all([
      this.getSettings(),
      this.database.client.videoAdOverride.findUnique({ where: { channelId: video.channelId } }),
      this.database.client.videoAdOverride.findUnique({ where: { videoId: video.id } }),
    ]);
    if (!settings.masterEnabled) return { enabled: false, reason: "ADS_DISABLED" as const };

    const resolved = resolveVideoAdPolicy(settings, channelOverride, videoOverride);
    if (!resolved.enabled) return { enabled: false, reason: "CONTENT_OVERRIDE_DISABLED" as const };

    const tagUrl =
      resolved.vastTagUrl ?? settings.externalVastTagUrl ?? this.houseTagUrl(origin, settings);
    if (!tagUrl) return { enabled: false, reason: "NO_AD_SOURCE_CONFIGURED" as const };

    return {
      enabled: true as const,
      provider: resolved.provider,
      tagUrl,
      preRollEnabled: resolved.preRollEnabled,
      midRollEnabled:
        resolved.midRollEnabled && (video.durationMs ?? 0) >= resolved.midRollEverySec * 1000,
      postRollEnabled: resolved.postRollEnabled,
      midRollEverySec: resolved.midRollEverySec,
      frequencyCapPerSession: settings.frequencyCapPerSession,
      attribution: { videoId: video.id, channelId: video.channelId },
    };
  }

  async upsertOverride(
    actorAccountId: string,
    target: { channelId?: string; videoId?: string },
    input: unknown,
  ) {
    const data = overrideSchema.parse(input);
    if ((target.channelId ? 1 : 0) + (target.videoId ? 1 : 0) !== 1) {
      throw new Error("Exactly one video ad override target is required.");
    }
    const writeData = this.overrideWriteData(data, actorAccountId);
    return this.database.client.$transaction(async (tx) => {
      let row;
      let entityType: "Channel" | "Video";
      let entityId: string;
      if (target.channelId) {
        await tx.channel.findUniqueOrThrow({ where: { id: target.channelId } });
        row = await tx.videoAdOverride.upsert({
          where: { channelId: target.channelId },
          update: writeData,
          create: { channelId: target.channelId, ...writeData },
        });
        entityType = "Channel";
        entityId = target.channelId;
      } else {
        const videoId = target.videoId as string;
        await tx.video.findUniqueOrThrow({ where: { id: videoId } });
        row = await tx.videoAdOverride.upsert({
          where: { videoId },
          update: writeData,
          create: { videoId, ...writeData },
        });
        entityType = "Video";
        entityId = videoId;
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "VIDEO_AD_OVERRIDE_UPDATED",
        entityType,
        entityId,
        metadata: data,
      });
      return row;
    });
  }

  async deleteOverride(actorAccountId: string, target: { channelId?: string; videoId?: string }) {
    if ((target.channelId ? 1 : 0) + (target.videoId ? 1 : 0) !== 1) {
      throw new Error("Exactly one video ad override target is required.");
    }
    return this.database.client.$transaction(async (tx) => {
      let result: { count: number };
      let entityType: "Channel" | "Video";
      let entityId: string;
      if (target.channelId) {
        result = await tx.videoAdOverride.deleteMany({ where: { channelId: target.channelId } });
        entityType = "Channel";
        entityId = target.channelId;
      } else {
        const videoId = target.videoId as string;
        result = await tx.videoAdOverride.deleteMany({ where: { videoId } });
        entityType = "Video";
        entityId = videoId;
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "VIDEO_AD_OVERRIDE_REMOVED",
        entityType,
        entityId,
        metadata: { deleted: result.count },
      });
      return { deleted: result.count > 0 };
    });
  }

  async recordEvent(input: VideoAdEventInput) {
    const placement = await this.database.client.adPlacement.upsert({
      where: { key: `player_${input.slot.toLowerCase()}` },
      update: {},
      create: {
        key: `player_${input.slot.toLowerCase()}`,
        name: `Player ${input.slot.replaceAll("_", " ").toLowerCase()}`,
        inventoryFamily: "IN_PLAYER_VIDEO",
        format: input.slot,
        enabled: true,
        config: { system: true, task: 19 },
      },
    });
    return this.database.client.adEvent.create({
      data: {
        placementId: placement.id,
        videoId: input.videoId,
        eventType: input.eventType,
        requestId: input.requestId ?? null,
        sessionId: input.sessionId ?? null,
        metadata: {
          provider: input.provider,
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        },
      },
      select: { id: true },
    });
  }

  getHouseVast(settings: VideoAdSettings) {
    if (!settings.houseCreativeUrl) return null;
    const click = settings.houseClickUrl
      ? `<ClickThrough><![CDATA[${this.xml(settings.houseClickUrl)}]]></ClickThrough>`
      : "";
    return `<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"><Ad id="ayin-house-v1"><InLine><AdSystem>AYIN House</AdSystem><AdTitle>AYIN House Test</AdTitle><Impression><![CDATA[]]></Impression><Creatives><Creative><Linear><Duration>00:00:15</Duration><MediaFiles><MediaFile delivery="progressive" type="video/mp4"><![CDATA[${this.xml(settings.houseCreativeUrl)}]]></MediaFile></MediaFiles><VideoClicks>${click}</VideoClicks></Linear></Creative></Creatives></InLine></Ad></VAST>`;
  }

  private overrideWriteData(data: VideoAdOverrideInput, actorAccountId: string) {
    return {
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(data.preRollEnabled !== undefined ? { preRollEnabled: data.preRollEnabled } : {}),
      ...(data.midRollEnabled !== undefined ? { midRollEnabled: data.midRollEnabled } : {}),
      ...(data.postRollEnabled !== undefined ? { postRollEnabled: data.postRollEnabled } : {}),
      ...(data.provider !== undefined ? { provider: data.provider } : {}),
      ...(data.vastTagUrl !== undefined ? { vastTagUrl: data.vastTagUrl } : {}),
      ...(data.midRollEverySec !== undefined ? { midRollEverySec: data.midRollEverySec } : {}),
      updatedBy: actorAccountId,
    };
  }

  private houseTagUrl(origin: string | null, settings: VideoAdSettings) {
    if (!settings.houseCreativeUrl || !origin) return null;
    return `${origin.replace(/\/$/, "")}/ads/house/vast`;
  }

  private xml(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
}
