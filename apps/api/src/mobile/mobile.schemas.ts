import { z } from "zod";

export const mobileNotificationTypes = [
  "system",
  "channel",
  "video",
  "comment",
  "subscription",
  "moderation",
  "monetization",
] as const;
export const mobileNotificationTypeSchema = z.enum(mobileNotificationTypes);
export type MobileNotificationType = z.infer<typeof mobileNotificationTypeSchema>;
export const mobileVersionSchema = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);
const platformVersions = z
  .object({ android: mobileVersionSchema, ios: mobileVersionSchema })
  .strict();
const adUnit = z
  .string()
  .max(256)
  .refine(
    (value) =>
      !/\s/.test(value) &&
      /^(?:|ca-app-pub-\d{16}\/\d{10}|\/[0-9]{1,20}(?:\/[A-Za-z0-9_.-]+)+)$/.test(value),
    "Expected an AdMob unit ID or Google Ad Manager /network/unit path",
  );
const unitIds = z
  .object({ enabled: z.boolean(), bannerUnitId: adUnit, interstitialUnitId: adUnit })
  .strict();
export const mobileRuntimeConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    bridgeVersion: z.literal(1),
    minimumAppVersion: platformVersions,
    latestAppVersion: platformVersions,
    ads: z
      .object({
        enabled: z.boolean(),
        testMode: z.boolean(),
        audience: z.enum(["unknown", "general", "children"]),
        banner: z.object({ enabled: z.boolean() }).strict(),
        interstitial: z
          .object({
            enabled: z.boolean(),
            cooldownSeconds: z.number().int().min(60).max(3600),
            maxPerSession: z.number().int().min(0).max(20),
          })
          .strict(),
        platforms: z.object({ android: unitIds, ios: unitIds }).strict(),
        requestTimeoutMs: z.number().int().min(1000).max(30000),
        retryCount: z.number().int().min(0).max(3),
        retryBackoffMs: z.number().int().min(500).max(30000),
      })
      .strict(),
    analytics: z.object({ enabled: z.boolean() }).strict(),
    notifications: z
      .object({
        enabled: z.boolean(),
        types: z
          .array(mobileNotificationTypeSchema)
          .max(7)
          .refine((v) => new Set(v).size === v.length),
        richMedia: z.literal(false),
      })
      .strict(),
    web: z
      .object({
        mode: z.literal("hosted"),
        origin: z.literal("https://ayin.stream"),
        minimumBridgeVersion: z.literal(1),
        rolloutPercent: z.number().int().min(0).max(100),
        bundleUpdatesEnabled: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.ads.enabled && config.ads.audience === "unknown")
      ctx.addIssue({
        code: "custom",
        path: ["ads", "audience"],
        message: "Declare the intended audience before enabling ads.",
      });
    // Audience-specific product design and Families compliance require a reviewed native release.
    if (config.ads.enabled && config.ads.audience === "children")
      ctx.addIssue({
        code: "custom",
        path: ["ads", "audience"],
        message: "Child-directed native advertising is not enabled in bridge v1.",
      });
    if (config.ads.enabled && !config.ads.testMode) {
      for (const platform of ["android", "ios"] as const) {
        if (!config.ads.platforms[platform].enabled) continue;
        for (const format of ["banner", "interstitial"] as const) {
          if (config.ads[format].enabled && !config.ads.platforms[platform][`${format}UnitId`])
            ctx.addIssue({
              code: "custom",
              path: ["ads", "platforms", platform],
              message:
                "Production advertising requires an app ad unit for each enabled format and platform.",
            });
        }
      }
    }
    for (const platform of ["android", "ios"] as const) {
      const min = config.minimumAppVersion[platform].split("-")[0]!.split(".").map(Number);
      const latest = config.latestAppVersion[platform].split("-")[0]!.split(".").map(Number);
      const firstDifference = min.findIndex((value, index) => value !== latest[index]);
      if (firstDifference !== -1 && min[firstDifference]! > latest[firstDifference]!)
        ctx.addIssue({
          code: "custom",
          path: ["minimumAppVersion", platform],
          message: "Minimum version cannot exceed latest version.",
        });
    }
  });
export type MobileRuntimeConfig = z.infer<typeof mobileRuntimeConfigSchema>;
export const defaultMobileRuntimeConfig: MobileRuntimeConfig = {
  schemaVersion: 1,
  bridgeVersion: 1,
  minimumAppVersion: { android: "1.0.0", ios: "1.0.0" },
  latestAppVersion: { android: "1.1.0", ios: "1.1.0" },
  ads: {
    enabled: false,
    testMode: true,
    audience: "unknown",
    banner: { enabled: false },
    interstitial: { enabled: false, cooldownSeconds: 180, maxPerSession: 3 },
    platforms: {
      android: { enabled: false, bannerUnitId: "", interstitialUnitId: "" },
      ios: { enabled: false, bannerUnitId: "", interstitialUnitId: "" },
    },
    requestTimeoutMs: 10000,
    retryCount: 1,
    retryBackoffMs: 2000,
  },
  analytics: { enabled: false },
  notifications: { enabled: false, types: [...mobileNotificationTypes], richMedia: false },
  web: {
    mode: "hosted",
    origin: "https://ayin.stream",
    minimumBridgeVersion: 1,
    rolloutPercent: 100,
    bundleUpdatesEnabled: false,
  },
};
export const mobilePreferencesSchema = z
  .object({
    system: z.boolean().default(false),
    channel: z.boolean().default(false),
    video: z.boolean().default(false),
    comment: z.boolean().default(false),
    subscription: z.boolean().default(false),
    moderation: z.boolean().default(false),
    monetization: z.boolean().default(false),
  })
  .strict();
export const mobileDeviceSchema = z
  .object({
    installationId: z.string().uuid(),
    token: z
      .string()
      .min(20)
      .max(4096)
      .regex(/^[a-zA-Z0-9_:.-]+$/),
    platform: z.enum(["android", "ios"]),
    appVersion: mobileVersionSchema,
    preferences: mobilePreferencesSchema,
  })
  .strict();
export type MobileDeviceInput = z.infer<typeof mobileDeviceSchema>;
export const mobileDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("video"), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("channel"), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("notifications") }).strict(),
]);
export const mobilePushInputSchema = z
  .object({
    accountId: z.string().uuid(),
    installationId: z.string().uuid().optional(),
    dedupeKey: z.string().uuid(),
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(240),
    type: mobileNotificationTypeSchema,
    destination: mobileDestinationSchema,
    reason: z.string().trim().min(4).max(500),
  })
  .strict();
export type MobilePushInput = z.infer<typeof mobilePushInputSchema>;
