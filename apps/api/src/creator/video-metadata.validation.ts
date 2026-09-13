import { z } from "zod";

import { ISO_3166_ALPHA2 } from "../video-policy/country-codes.js";

export const VIDEO_DESCRIPTION_MAX_LENGTH = 20_000;
export const VIDEO_TAG_MAX_COUNT = 20;
export const VIDEO_TAG_MAX_LENGTH = 40;
export const VIDEO_CHAPTER_MAX_COUNT = 100;
export const VIDEO_CHAPTER_TITLE_MAX_LENGTH = 100;
export const VIDEO_AD_BREAK_MAX_COUNT = 20;
export const VIDEO_TERRITORY_MAX_COUNT = 100;

export const VIDEO_CATEGORIES = [
  "ENTERTAINMENT",
  "EDUCATION",
  "GAMING",
  "MUSIC",
  "NEWS",
  "SPORTS",
  "TECHNOLOGY",
  "LIFESTYLE",
  "FILM_ANIMATION",
  "OTHER",
] as const;
export const VIDEO_CONTENT_TYPES = ["CREATOR_VIDEO", "MOVIE", "DOCUMENTARY"] as const;
export const RIGHTS_BASES = ["OWNED", "LICENSED", "AUTHORIZED", "PUBLIC_DOMAIN", "OTHER"] as const;

const languageSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, "Use a valid BCP 47 language code, such as en or ar-EG.")
  .transform((value) => Intl.getCanonicalLocales(value)[0]!);
const tagSchema = z.string().trim().min(1).max(VIDEO_TAG_MAX_LENGTH);
const territorySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => ISO_3166_ALPHA2.has(value),
    "Use an ISO 3166-1 alpha-2 country code such as EG, US or GB.",
  );
const territoryListSchema = z
  .array(territorySchema)
  .max(VIDEO_TERRITORY_MAX_COUNT)
  .transform((values) => [...new Set(values)]);
const chapterSchema = z.object({
  title: z.string().trim().min(1).max(VIDEO_CHAPTER_TITLE_MAX_LENGTH),
  startSeconds: z.number().finite().int().min(0),
});

export const videoMetadataSchema = z
  .object({
    tags: z
      .array(tagSchema)
      .max(VIDEO_TAG_MAX_COUNT)
      .transform((tags) => [...new Set(tags.map((tag) => tag.toLocaleLowerCase()))])
      .optional(),
    category: z.enum(VIDEO_CATEGORIES).nullable().optional(),
    primaryLanguage: languageSchema.nullable().optional(),
    recordingDate: z.string().date().nullable().optional(),
    contentType: z.enum(VIDEO_CONTENT_TYPES).optional(),
    rightsBasis: z.enum(RIGHTS_BASES).optional(),
    rightsNote: z.string().trim().max(1_000).nullable().optional(),
    rightsExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    seriesTitle: z.string().trim().min(1).max(120).nullable().optional(),
    seasonNumber: z.number().int().min(1).max(10_000).nullable().optional(),
    episodeNumber: z.number().int().min(1).max(100_000).nullable().optional(),
    maturityLevel: z.enum(["GENERAL", "TEEN", "MATURE"]).nullable().optional(),
    ageRestriction: z.enum(["NONE", "AGE_13_PLUS", "AGE_18_PLUS"]).nullable().optional(),
    allowedTerritories: territoryListSchema.optional(),
    blockedTerritories: territoryListSchema.optional(),
    // Legacy Task 51 compatibility. New clients use allow/block lists directly.
    geoAvailabilityMode: z.enum(["WORLDWIDE", "INCLUDE_ONLY", "EXCLUDE"]).nullable().optional(),
    geoCountries: territoryListSchema.optional(),
    chapters: z.array(chapterSchema).max(VIDEO_CHAPTER_MAX_COUNT).nullable().optional(),
    adBreakPreference: z.enum(["AUTOMATIC", "DISABLED", "CUSTOM"]).nullable().optional(),
    adBreakOffsetsSeconds: z
      .array(z.number().finite().int().min(1))
      .max(VIDEO_AD_BREAK_MAX_COUNT)
      .transform((offsets) => [...new Set(offsets)].sort((a, b) => a - b))
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      value.recordingDate &&
      new Date(`${value.recordingDate}T00:00:00.000Z`).getTime() > Date.now()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recordingDate"],
        message: "Recording date cannot be in the future.",
      });
    }
    if (
      (value.allowedTerritories !== undefined || value.blockedTerritories !== undefined) &&
      (value.geoAvailabilityMode !== undefined || value.geoCountries !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedTerritories"],
        message: "Use either allow/block territory lists or the legacy geographic mode, not both.",
      });
    }
    const blocked = new Set(value.blockedTerritories ?? []);
    const overlap = (value.allowedTerritories ?? []).find((country) => blocked.has(country));
    if (overlap) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockedTerritories"],
        message: `${overlap} cannot be both allowed and blocked.`,
      });
    }
    if (value.geoAvailabilityMode === "WORLDWIDE" && (value.geoCountries?.length ?? 0) > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geoCountries"],
        message: "Worldwide availability cannot include a country list.",
      });
    }
    if (
      (value.geoAvailabilityMode === "INCLUDE_ONLY" || value.geoAvailabilityMode === "EXCLUDE") &&
      (value.geoCountries?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geoCountries"],
        message: "Choose at least one country for this geographic availability mode.",
      });
    }
    if (value.chapters) {
      for (let index = 1; index < value.chapters.length; index += 1) {
        if (value.chapters[index]!.startSeconds <= value.chapters[index - 1]!.startSeconds) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["chapters", index, "startSeconds"],
            message: "Chapter start times must be strictly increasing.",
          });
        }
      }
    }
    if (value.adBreakPreference === "CUSTOM" && (value.adBreakOffsetsSeconds?.length ?? 0) === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adBreakOffsetsSeconds"],
        message: "Add at least one offset for custom ad breaks.",
      });
    }
    if (value.adBreakPreference !== "CUSTOM" && (value.adBreakOffsetsSeconds?.length ?? 0) > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adBreakOffsetsSeconds"],
        message: "Ad-break offsets are only used with the custom preference.",
      });
    }
  });

export type VideoMetadataInput = z.infer<typeof videoMetadataSchema>;

export function validateMetadataDuration(
  input: VideoMetadataInput,
  durationMs: number | null,
): void {
  if (!durationMs || durationMs <= 0) return;
  const durationSeconds = durationMs / 1000;
  if (input.chapters?.some((chapter) => chapter.startSeconds >= durationSeconds))
    throw new Error("CHAPTER_OUTSIDE_VIDEO");
  if (input.adBreakOffsetsSeconds?.some((offset) => offset >= durationSeconds))
    throw new Error("AD_BREAK_OUTSIDE_VIDEO");
}

export function metadataData(input: VideoMetadataInput) {
  return {
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.primaryLanguage !== undefined ? { primaryLanguage: input.primaryLanguage } : {}),
    ...(input.recordingDate !== undefined
      ? {
          recordingDate: input.recordingDate
            ? new Date(`${input.recordingDate}T00:00:00.000Z`)
            : null,
        }
      : {}),
    ...(input.seriesTitle !== undefined ? { seriesTitle: input.seriesTitle } : {}),
    ...(input.seasonNumber !== undefined ? { seasonNumber: input.seasonNumber } : {}),
    ...(input.episodeNumber !== undefined ? { episodeNumber: input.episodeNumber } : {}),
    ...(input.chapters !== undefined ? { chapters: input.chapters } : {}),
    ...(input.adBreakPreference !== undefined
      ? { adBreakPreference: input.adBreakPreference }
      : {}),
    ...(input.adBreakOffsetsSeconds !== undefined
      ? { adBreakOffsetsSeconds: input.adBreakOffsetsSeconds }
      : {}),
  };
}

export function policyData(input: VideoMetadataInput) {
  const data: Record<string, unknown> = {};
  if (input.maturityLevel !== undefined) data.maturityLevel = input.maturityLevel;
  if (input.ageRestriction !== undefined) data.ageRestriction = input.ageRestriction ?? "NONE";
  if (input.rightsExpiresAt !== undefined)
    data.rightsExpiresAt = input.rightsExpiresAt ? new Date(input.rightsExpiresAt) : null;
  if (input.allowedTerritories !== undefined) data.allowedTerritories = input.allowedTerritories;
  if (input.blockedTerritories !== undefined) data.blockedTerritories = input.blockedTerritories;
  if (input.geoAvailabilityMode !== undefined || input.geoCountries !== undefined) {
    const countries = input.geoCountries ?? [];
    if (input.geoAvailabilityMode === "INCLUDE_ONLY") {
      data.allowedTerritories = countries;
      data.blockedTerritories = [];
    } else if (input.geoAvailabilityMode === "EXCLUDE") {
      data.allowedTerritories = [];
      data.blockedTerritories = countries;
    } else {
      data.allowedTerritories = [];
      data.blockedTerritories = [];
    }
  }
  return data;
}

export function hasCompanionMetadata(input: VideoMetadataInput): boolean {
  return [
    "tags",
    "category",
    "primaryLanguage",
    "recordingDate",
    "seriesTitle",
    "seasonNumber",
    "episodeNumber",
    "chapters",
    "adBreakPreference",
    "adBreakOffsetsSeconds",
  ].some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

export function hasPolicyMetadata(input: VideoMetadataInput): boolean {
  return [
    "maturityLevel",
    "ageRestriction",
    "rightsExpiresAt",
    "allowedTerritories",
    "blockedTerritories",
    "geoAvailabilityMode",
    "geoCountries",
  ].some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

export function hasAnyAdvancedMetadata(input: VideoMetadataInput): boolean {
  return (
    hasCompanionMetadata(input) ||
    hasPolicyMetadata(input) ||
    input.contentType !== undefined ||
    input.rightsBasis !== undefined ||
    input.rightsNote !== undefined
  );
}
