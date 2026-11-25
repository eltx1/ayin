import type { Prisma } from "@ayin/db";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import {
  lockAdminAccountWrite,
  type AccountWriteActor,
} from "../admin/admin-account-write-authority.js";
import { DatabaseService } from "../database/database.service.js";
import { pageAdSlotCatalog, pageAdSlotDefinition } from "./ad-slot-catalog.js";
import { AdvertisingControlService } from "./advertising-control.service.js";
import {
  gamAdUnitPathPattern,
  pageAdCodeMaxLength,
  pageAdPlacementConfigSchema,
  PageAdService,
} from "./page-ad.service.js";
import { defaultMaxMidRollsPerVideo, VideoAdService } from "./video-ad.service.js";

export type SimpleSlotSource = "CODE" | "GAM_UNIT" | "HOUSE" | "NONE";

const deviceSchema = z.enum(["MOBILE", "DESKTOP", "TV"]);

export const slotUpdateSchema = z
  .object({
    enabled: z.boolean(),
    source: z.enum(["CODE", "GAM_UNIT", "NONE"]),
    code: z.string().max(pageAdCodeMaxLength).nullable(),
    adUnitPath: z.string().trim().max(500).nullable(),
    height: z.number().int().min(20).max(1200).nullable(),
    devices: z.array(deviceSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.source === "GAM_UNIT" &&
      value.adUnitPath &&
      !gamAdUnitPathPattern.test(value.adUnitPath)
    )
      ctx.addIssue({
        code: "custom",
        path: ["adUnitPath"],
        message: "AD_UNIT_PATH_INVALID",
      });
    if (!value.enabled) return;
    if (value.source === "NONE")
      ctx.addIssue({ code: "custom", path: ["source"], message: "SOURCE_REQUIRED" });
    if (value.source === "CODE" && !value.code?.trim())
      ctx.addIssue({ code: "custom", path: ["code"], message: "CODE_REQUIRED" });
    if (value.source === "GAM_UNIT" && !value.adUnitPath)
      ctx.addIssue({ code: "custom", path: ["adUnitPath"], message: "AD_UNIT_PATH_REQUIRED" });
  });

const vastField = z
  .string()
  .trim()
  .max(4096)
  .nullable()
  .transform((value) => (value ? value : null))
  .refine((value) => {
    if (value === null) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "VAST_TAG_INVALID");

export const videoUpdateSchema = z
  .object({
    masterEnabled: z.boolean(),
    preRoll: z.object({ enabled: z.boolean(), vastTagUrl: vastField }).strict(),
    midRoll: z
      .object({
        enabled: z.boolean(),
        vastTagUrl: vastField,
        mode: z.enum(["INTERVAL", "CUE_POINTS"]),
        everySec: z.number().int().min(60).max(7200),
        cuePointsSec: z.array(z.number().int().min(10).max(86_400)).max(50),
        maxBreaks: z.number().int().min(1).max(50),
      })
      .strict(),
    postRoll: z.object({ enabled: z.boolean(), vastTagUrl: vastField }).strict(),
    frequencyCapPerSession: z.number().int().min(0).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ["preRoll", "midRoll", "postRoll"] as const) {
      if (value.masterEnabled && value[key].enabled && !value[key].vastTagUrl)
        ctx.addIssue({ code: "custom", path: [key, "vastTagUrl"], message: "VAST_TAG_REQUIRED" });
    }
    if (
      value.midRoll.enabled &&
      value.midRoll.mode === "CUE_POINTS" &&
      value.midRoll.cuePointsSec.length === 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["midRoll", "cuePointsSec"],
        message: "CUE_POINTS_REQUIRED",
      });
  });

export const webUpdateSchema = z.object({ masterEnabled: z.boolean() }).strict();
export const reportQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});
/** Placements the video ad service records breaks under (see VideoAdService.recordEvent). */
const videoReportKeys = ["player_pre_roll", "player_mid_roll", "player_post_roll"] as const;
export const emergencyUpdateSchema = z
  .object({ enabled: z.boolean(), reason: z.string().trim().min(1).max(1000).optional() })
  .strict();

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

/**
 * The simplified advertising surface: one read model and four small writes that sit on top of
 * the existing page, video and emergency-switch storage. Nothing here needs server environment
 * variables, so an administrator can run all web and video inventory from the admin panel.
 */
@Injectable()
export class AdManagerService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
    @Inject(PageAdService) private readonly pageAds: PageAdService,
    @Inject(VideoAdService) private readonly videoAds: VideoAdService,
    @Inject(AdvertisingControlService) private readonly advertising: AdvertisingControlService,
  ) {}

  async overview() {
    await this.ensureCatalogPlacements();
    const [emergencyStop, pageSettings, placements, video] = await Promise.all([
      this.advertising.isEmergencyKilled(),
      this.pageAds.getSettings(),
      this.database.client.adPlacement.findMany({
        where: {
          inventoryFamily: "OUTSIDE_PLAYER",
          key: { in: pageAdSlotCatalog.map((slot) => slot.key) },
        },
      }),
      this.videoAds.getSettings(),
    ]);
    const byKey = new Map(placements.map((placement) => [placement.key, placement]));
    const external = video.externalVastTagUrl;
    return {
      emergencyStop,
      web: {
        masterEnabled: pageSettings.masterEnabled,
        slots: pageAdSlotCatalog.map((definition) => {
          const placement = byKey.get(definition.key);
          const parsed = pageAdPlacementConfigSchema.safeParse(placement?.config);
          const demand = parsed.success ? parsed.data.demand : null;
          const source: SimpleSlotSource =
            demand?.source === "CODE"
              ? "CODE"
              : demand?.source === "HOUSE"
                ? "HOUSE"
                : demand?.source === "GAM_UNIT" || demand?.adUnitPath
                  ? "GAM_UNIT"
                  : "NONE";
          return {
            key: definition.key,
            name: definition.name,
            where: definition.where,
            sizes: definition.sizes,
            enabled: Boolean(placement?.enabled),
            source,
            code: demand?.code ?? null,
            adUnitPath: demand?.adUnitPath ?? null,
            height: demand?.height ?? null,
            devices: parsed.success ? parsed.data.devices : definition.devices,
            updatedAt: placement?.updatedAt.toISOString() ?? null,
          };
        }),
      },
      video: {
        masterEnabled: video.masterEnabled,
        preRoll: {
          enabled: video.preRollEnabled,
          vastTagUrl: video.slotVastTags?.PRE_ROLL ?? external,
        },
        midRoll: {
          enabled: video.midRollEnabled,
          vastTagUrl: video.slotVastTags?.MID_ROLL ?? external,
          mode: video.midRollMode ?? "INTERVAL",
          everySec: video.midRollEverySec,
          cuePointsSec: video.midRollCuePointsSec ?? [],
          maxBreaks: video.maxMidRollsPerVideo ?? defaultMaxMidRollsPerVideo,
        },
        postRoll: {
          enabled: video.postRollEnabled,
          vastTagUrl: video.slotVastTags?.POST_ROLL ?? external,
        },
        frequencyCapPerSession: video.frequencyCapPerSession,
      },
    };
  }

  async updateWeb(actor: AccountWriteActor, input: unknown) {
    const { masterEnabled } = webUpdateSchema.parse(input);
    const current = await this.pageAds.getSettings();
    await this.pageAds.updateSettings(actor, { ...current, masterEnabled });
    await this.audit.record({
      actorAccountId: actor.accountId,
      action: "AD_MANAGER_WEB_UPDATED",
      entityType: "PlatformSetting",
      entityId: "ADVERTISING/pageAdsV1",
      metadata: { masterEnabled },
    });
    return this.overview();
  }

  async updateSlot(actor: AccountWriteActor, key: string, input: unknown) {
    const definition = pageAdSlotDefinition(key);
    if (!definition) throw new NotFoundException("Unknown ad slot.");
    const data = slotUpdateSchema.parse(input);
    await this.ensureCatalogPlacements();
    await this.database.client.$transaction(async (tx) => {
      await lockAdminAccountWrite(tx, actor, actor.accountId, undefined, ["AD_MANAGER"]);
      const placement = await tx.adPlacement.findUnique({ where: { key } });
      if (!placement) throw new NotFoundException("Unknown ad slot.");
      const previous = pageAdPlacementConfigSchema.safeParse(placement.config);
      const config = pageAdPlacementConfigSchema.parse({
        routePatterns: definition.routePatterns,
        sizes: definition.sizes,
        responsive: definition.responsive,
        devices: [...new Set(data.devices)],
        audience: previous.success ? previous.data.audience : "ANY",
        categories: previous.success ? previous.data.categories : [],
        demand: {
          source: data.source === "NONE" ? "GOOGLE_GPT" : data.source,
          adUnitPath: data.source === "GAM_UNIT" ? data.adUnitPath || null : null,
          code: data.code?.trim() ? data.code : null,
          height: data.height,
        },
        fallback: "COLLAPSE",
      });
      await tx.adPlacement.update({
        where: { id: placement.id },
        data: { enabled: data.enabled && data.source !== "NONE", config: json(config) },
      });
      await lockAdminAccountWrite(tx, actor, actor.accountId, undefined, ["AD_MANAGER"]);
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor.accountId,
        action: "AD_MANAGER_SLOT_UPDATED",
        entityType: "AdPlacement",
        entityId: placement.id,
        metadata: {
          key,
          enabled: data.enabled,
          source: data.source,
          devices: data.devices,
          codeLength: data.code?.length ?? 0,
        },
      });
    });
    return this.overview();
  }

  async updateVideo(actor: AccountWriteActor, input: unknown) {
    const data = videoUpdateSchema.parse(input);
    const current = await this.videoAds.getSettings();
    await this.videoAds.updateSettings(actor, {
      ...current,
      masterEnabled: data.masterEnabled,
      preRollEnabled: data.preRoll.enabled,
      midRollEnabled: data.midRoll.enabled,
      postRollEnabled: data.postRoll.enabled,
      midRollEverySec: data.midRoll.everySec,
      midRollMode: data.midRoll.mode,
      midRollCuePointsSec: [...new Set(data.midRoll.cuePointsSec)].sort((a, b) => a - b),
      maxMidRollsPerVideo: data.midRoll.maxBreaks,
      frequencyCapPerSession: data.frequencyCapPerSession,
      slotVastTags: {
        PRE_ROLL: data.preRoll.vastTagUrl,
        MID_ROLL: data.midRoll.vastTagUrl,
        POST_ROLL: data.postRoll.vastTagUrl,
      },
    });
    return this.overview();
  }

  async updateEmergency(actor: AccountWriteActor, input: unknown) {
    const data = emergencyUpdateSchema.parse(input);
    await this.advertising.setEmergencyKillSwitch(actor, data.enabled, data.reason);
    return this.overview();
  }

  /**
   * Per-slot delivery counts recorded by AYIN's own players and slots over the last `days` days.
   * These are AYIN-side measurements (requests the page made, ads it rendered); revenue stays in
   * Ad Manager's own reports.
   */
  async report(input: unknown) {
    const { days } = reportQuerySchema.parse(input);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const keys = [...pageAdSlotCatalog.map((slot) => slot.key), ...videoReportKeys];
    const placements = await this.database.client.adPlacement.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const grouped = placements.length
      ? await this.database.client.adEvent.groupBy({
          by: ["placementId", "eventType"],
          where: {
            placementId: { in: placements.map((placement) => placement.id) },
            occurredAt: { gte: since },
          },
          _count: { _all: true },
        })
      : [];
    const keyById = new Map(placements.map((placement) => [placement.id, placement.key]));
    const counts = new Map<string, Record<string, number>>();
    for (const row of grouped) {
      const key = keyById.get(row.placementId);
      if (!key) continue;
      const entry = counts.get(key) ?? {};
      entry[row.eventType] = (entry[row.eventType] ?? 0) + row._count._all;
      counts.set(key, entry);
    }
    const metric = (key: string, type: string) => counts.get(key)?.[type] ?? 0;
    return {
      days,
      since: since.toISOString(),
      web: pageAdSlotCatalog.map((slot) => ({
        key: slot.key,
        requests: metric(slot.key, "REQUEST"),
        impressions: metric(slot.key, "IMPRESSION"),
        clicks: metric(slot.key, "CLICK"),
        errors: metric(slot.key, "ERROR"),
      })),
      video: videoReportKeys.map((key) => ({
        key,
        requests: metric(key, "REQUEST"),
        impressions: metric(key, "IMPRESSION"),
        starts: metric(key, "START"),
        completes: metric(key, "COMPLETE"),
        clicks: metric(key, "CLICK"),
        errors: metric(key, "ERROR"),
      })),
    };
  }

  /** Placements that the web renders but older databases never seeded start disabled. */
  private async ensureCatalogPlacements() {
    const existing = await this.database.client.adPlacement.findMany({
      where: { key: { in: pageAdSlotCatalog.map((slot) => slot.key) } },
      select: { key: true },
    });
    const known = new Set(existing.map((row) => row.key));
    const missing = pageAdSlotCatalog.filter((slot) => !known.has(slot.key));
    if (missing.length === 0) return;
    await this.database.client.adPlacement.createMany({
      skipDuplicates: true,
      data: missing.map((slot) => ({
        key: slot.key,
        name: slot.name.en,
        inventoryFamily: "OUTSIDE_PLAYER" as const,
        format: "DISPLAY" as const,
        enabled: false,
        config: json({
          routePatterns: slot.routePatterns,
          sizes: slot.sizes,
          responsive: slot.responsive,
          devices: slot.devices,
          audience: "ANY",
          categories: [],
          demand: { source: "GOOGLE_GPT", adUnitPath: null },
          fallback: "COLLAPSE",
        }),
      })),
    });
  }
}
