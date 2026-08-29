import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

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
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getSettings(): Promise<VideoAdSettings> {
    const row = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "videoAdsV1" } },
      select: { value: true },
    });
    const parsed = videoAdSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : defaultVideoAdSettings;
  }

  async updateSettings(input: unknown): Promise<VideoAdSettings> {
    const settings = videoAdSettingsSchema.parse(input);
    const value = settings as unknown as Prisma.InputJsonValue;
    await this.database.client.platformSetting.upsert({
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
    return settings;
  }

  async getDecision(videoId: string, origin: string | null) {
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
    if (target.channelId) {
      await this.database.client.channel.findUniqueOrThrow({ where: { id: target.channelId } });
      return this.database.client.videoAdOverride.upsert({
        where: { channelId: target.channelId },
        update: { ...data, updatedBy: actorAccountId },
        create: { channelId: target.channelId, ...data, updatedBy: actorAccountId },
      });
    }
    const videoId = target.videoId as string;
    await this.database.client.video.findUniqueOrThrow({ where: { id: videoId } });
    return this.database.client.videoAdOverride.upsert({
      where: { videoId },
      update: { ...data, updatedBy: actorAccountId },
      create: { videoId, ...data, updatedBy: actorAccountId },
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

  private houseTagUrl(origin: string | null, settings: VideoAdSettings) {
    if (!settings.houseCreativeUrl || !origin) return null;
    return `${origin.replace(/\/$/, "")}/ads/house/vast`;
  }

  private xml(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
}
