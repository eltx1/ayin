import { z } from "zod";

export const analyticsEventNames = [
  "APP_OPEN",
  "SESSION_OPEN",
  "CONTENT_IMPRESSION",
  "CONTENT_CLICK",
  "VIDEO_START",
  "VIDEO_PROGRESS",
  "VIDEO_COMPLETE",
  "VIDEO_PAUSE",
  "VIDEO_SEEK",
  "VIDEO_BUFFER",
  "SEARCH",
  "SEARCH_CLICK",
  "SUBSCRIBE",
  "LIKE",
  "COMMENT",
  "SHARE",
  "CLIP_IMPRESSION",
  "CLIP_PLAY",
  "CLIP_SWIPE",
  "CLIP_COMPLETE",
  "CLIP_SHARE",
  "RECOMMENDATION_IMPRESSION",
  "RECOMMENDATION_CLICK",
  "LENS_OPEN",
  "LENS_DISMISS",
  "LENS_NOT_INTERESTED",
  "TV_START",
  "UPLOAD_START",
  "UPLOAD_COMPLETE",
  "PUBLISH",
  "AD_REQUEST",
  "AD_START",
  "AD_QUARTILE",
  "AD_COMPLETE",
  "AD_CLICK",
  "AD_ERROR",
] as const;

export const analyticsEventSchema = z
  .object({
    clientEventId: z.string().uuid(),
    schemaVersion: z.literal(1),
    eventName: z.enum(analyticsEventNames),
    occurredAt: z.string().datetime({ offset: true }),
    sessionId: z.string().trim().min(16).max(120),
    profileId: z.string().trim().min(8).max(120).nullable().optional(),
    videoId: z.string().uuid().nullable().optional(),
    channelId: z.string().uuid().nullable().optional(),
    source: z.enum(["WEB", "PWA", "MOBILE", "TV", "SERVER"]).default("WEB"),
    deviceClass: z.enum(["MOBILE", "TABLET", "DESKTOP", "TV", "UNKNOWN"]).nullable().optional(),
    durationDeltaMs: z.number().int().min(0).max(3_600_000).nullable().optional(),
    positionMs: z.number().int().min(0).nullable().optional(),
    metadata: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional(),
  })
  .strict();

export const analyticsBatchSchema = z
  .object({ events: z.array(analyticsEventSchema).min(1).max(100) })
  .strict();

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;
