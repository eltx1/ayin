import { z } from "zod";

const decimalString = z.string().regex(/^\d+(?:\.\d{1,6})?$/).max(40);

export const directCampaignConfigSchema = z.object({
  priority: z.number().int().min(1).max(1000).default(100),
  pricing: z.discriminatedUnion("model", [
    z.object({ model: z.literal("CPM"), cpm: decimalString, fixedPrice: z.null() }),
    z.object({ model: z.literal("FIXED"), cpm: z.null(), fixedPrice: decimalString }),
  ]),
  impressionGoal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  frequencyCap: z.number().int().min(0).max(100).default(3),
  pacing: z.enum(["EVEN", "ASAP"]).default("EVEN"),
  targeting: z.object({
    placementKeys: z.array(z.string().trim().min(1).max(120)).default([]),
    countries: z.array(z.string().trim().length(2).transform((value) => value.toUpperCase())).default([]),
    regions: z.array(z.string().trim().min(1).max(120)).default([]),
    devices: z.array(z.enum(["MOBILE", "DESKTOP", "TV"])).default([]),
    categories: z.array(z.string().trim().min(1).max(120)).default([]),
    channelIds: z.array(z.string().uuid()).default([]),
    videoIds: z.array(z.string().uuid()).default([]),
  }),
});

export type DirectCampaignConfigInput = z.infer<typeof directCampaignConfigSchema>;

export const advertiserCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).default("ACTIVE"),
});

export const advertiserPatchSchema = advertiserCreateSchema.partial();

export const campaignCreateSchema = z.object({
  advertiserId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).default("DRAFT"),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
  budget: decimalString.nullable().default(null),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).nullable().default(null),
  direct: directCampaignConfigSchema,
});

export const campaignPatchSchema = campaignCreateSchema.omit({ advertiserId: true }).partial();

export const creativeCreateSchema = z.object({
  campaignId: z.string().uuid(),
  mediaAssetId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(2).max(160),
  type: z.enum(["VIDEO", "DISPLAY", "NATIVE", "VAST_TAG"]),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "REJECTED", "ARCHIVED"]).default("DRAFT"),
  destinationUrl: z.string().url().max(4096).nullable().default(null),
  vastTagUrl: z.string().url().max(4096).nullable().default(null),
  headline: z.string().trim().max(200).nullable().default(null),
  body: z.string().trim().max(2000).nullable().default(null),
  direct: z.object({
    assetUrl: z.string().url().max(4096).nullable().default(null),
    width: z.number().int().min(1).max(4096).nullable().default(null),
    height: z.number().int().min(1).max(4096).nullable().default(null),
    approvedReference: z.string().trim().max(500).nullable().default(null),
  }),
});

export const creativePatchSchema = creativeCreateSchema.omit({ campaignId: true }).partial();

export const placementMutationSchema = z.object({
  key: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(160),
  inventoryFamily: z.enum(["IN_PLAYER_VIDEO", "OUTSIDE_PLAYER"]),
  format: z.enum(["PRE_ROLL", "MID_ROLL", "POST_ROLL", "DISPLAY", "NATIVE"]),
  enabled: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const placementPatchSchema = placementMutationSchema.partial();

export const directDecisionContextSchema = z.object({
  placementKey: z.string().trim().min(1).max(120),
  sessionId: z.string().trim().min(1).max(120),
  device: z.enum(["MOBILE", "DESKTOP", "TV"]),
  country: z.string().trim().length(2).transform((value) => value.toUpperCase()).nullable().optional(),
  region: z.string().trim().min(1).max(120).nullable().optional(),
  category: z.string().trim().min(1).max(120).nullable().optional(),
  channelId: z.string().uuid().nullable().optional(),
  videoId: z.string().uuid().nullable().optional(),
});

export type DirectDecisionContext = z.infer<typeof directDecisionContextSchema>;
