import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { DatabaseService } from "../database/database.service.js";
import {
  isPageAdEligible,
  type PageAdContext,
  type PageAdPlacementConfig,
} from "./page-ad-policy.js";

const adSizeSchema = z.tuple([
  z.number().int().positive().max(4096),
  z.number().int().positive().max(4096),
]);

export const pageAdPlacementConfigSchema = z.object({
  routePatterns: z.array(z.string().trim().min(1).max(200)).min(1),
  sizes: z.array(adSizeSchema).min(1),
  responsive: z
    .array(
      z.object({
        minWidth: z.number().int().min(0).max(10000),
        sizes: z.array(adSizeSchema).min(1),
      }),
    )
    .default([]),
  devices: z.array(z.enum(["MOBILE", "DESKTOP", "TV"])).min(1),
  audience: z.enum(["ANY", "SIGNED_IN", "SIGNED_OUT"]),
  categories: z.array(z.string().trim().min(1).max(120)).default([]),
  demand: z.object({
    source: z.enum(["GOOGLE_GPT", "HOUSE"]),
    adUnitPath: z.string().trim().min(1).max(500).nullable(),
  }),
  fallback: z.enum(["HOUSE", "COLLAPSE"]),
});

export const pageAdSettingsSchema = z.object({
  masterEnabled: z.boolean(),
  googleGptEnabled: z.boolean(),
  house: z.object({
    imageUrl: z.string().url().max(4096).nullable(),
    clickUrl: z.string().url().max(4096).nullable(),
    altText: z.string().trim().min(1).max(240).nullable(),
  }),
});

export type PageAdSettings = z.infer<typeof pageAdSettingsSchema>;

export const defaultPageAdSettings: PageAdSettings = {
  masterEnabled: false,
  googleGptEnabled: false,
  house: { imageUrl: null, clickUrl: null, altText: null },
};

export const pageAdEventSchema = z.object({
  key: z.string().trim().min(1).max(120),
  eventType: z.enum(["REQUEST", "FILL", "IMPRESSION", "CLICK", "ERROR"]),
  requestId: z.string().trim().min(1).max(120).nullable().optional(),
  sessionId: z.string().trim().min(1).max(120).nullable().optional(),
  provider: z.enum(["GOOGLE_GPT", "HOUSE"]),
  errorCode: z.string().trim().max(120).nullable().optional(),
});

export type PageAdEventInput = z.infer<typeof pageAdEventSchema>;

@Injectable()
export class PageAdService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getSettings(): Promise<PageAdSettings> {
    const row = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "pageAdsV1" } },
      select: { value: true },
    });
    const parsed = pageAdSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : defaultPageAdSettings;
  }

  async updateSettings(input: unknown): Promise<PageAdSettings> {
    const settings = pageAdSettingsSchema.parse(input);
    const value = settings as unknown as Prisma.InputJsonValue;
    await this.database.client.platformSetting.upsert({
      where: { namespace_key: { namespace: "ADVERTISING", key: "pageAdsV1" } },
      update: { value, valueType: "JSON", schemaVersion: 1 },
      create: {
        namespace: "ADVERTISING",
        key: "pageAdsV1",
        valueType: "JSON",
        value,
        schemaVersion: 1,
        description: "Task 20 outside-player advertising defaults.",
      },
    });
    return settings;
  }

  async getDecision(key: string, context: PageAdContext) {
    const killSwitch = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "emergencyKillSwitch" } },
      select: { value: true },
    });
    if (killSwitch?.value === true) {
      return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" as const };
    }

    const [settings, placement] = await Promise.all([
      this.getSettings(),
      this.database.client.adPlacement.findUnique({ where: { key } }),
    ]);
    if (!settings.masterEnabled) return { enabled: false as const, reason: "PAGE_ADS_DISABLED" };
    if (!placement || placement.inventoryFamily !== "OUTSIDE_PLAYER" || !placement.enabled) {
      return { enabled: false as const, reason: "PLACEMENT_DISABLED" };
    }

    const parsed = pageAdPlacementConfigSchema.safeParse(placement.config);
    if (!parsed.success) return { enabled: false as const, reason: "PLACEMENT_CONFIG_INVALID" };
    const config = parsed.data as PageAdPlacementConfig;
    if (!isPageAdEligible(config, context)) {
      return { enabled: false as const, reason: "PLACEMENT_NOT_ELIGIBLE" };
    }

    const house = settings.house.imageUrl
      ? {
          provider: "HOUSE" as const,
          imageUrl: settings.house.imageUrl,
          clickUrl: settings.house.clickUrl,
          altText: settings.house.altText ?? "Sponsored",
        }
      : null;

    if (config.demand.source === "HOUSE") {
      if (!house) return { enabled: false as const, reason: "NO_HOUSE_CREATIVE" };
      return {
        enabled: true as const,
        placementId: placement.id,
        key: placement.key,
        sizes: config.sizes,
        responsive: config.responsive,
        demand: house,
        fallback: null,
      };
    }

    if (!settings.googleGptEnabled || !config.demand.adUnitPath) {
      if (config.fallback === "HOUSE" && house) {
        return {
          enabled: true as const,
          placementId: placement.id,
          key: placement.key,
          sizes: config.sizes,
          responsive: config.responsive,
          demand: house,
          fallback: null,
        };
      }
      return { enabled: false as const, reason: "GPT_NOT_CONFIGURED" };
    }

    return {
      enabled: true as const,
      placementId: placement.id,
      key: placement.key,
      sizes: config.sizes,
      responsive: config.responsive,
      demand: {
        provider: "GOOGLE_GPT" as const,
        adUnitPath: config.demand.adUnitPath,
      },
      fallback: config.fallback === "HOUSE" ? house : null,
    };
  }

  async recordEvent(input: PageAdEventInput) {
    const placement = await this.database.client.adPlacement.findFirst({
      where: { key: input.key, inventoryFamily: "OUTSIDE_PLAYER" },
      select: { id: true },
    });
    if (!placement) return null;
    return this.database.client.adEvent.create({
      data: {
        placementId: placement.id,
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
}
