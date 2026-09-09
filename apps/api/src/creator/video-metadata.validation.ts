import { z } from "zod";

export const VIDEO_DESCRIPTION_MAX_LENGTH = 20_000;
export const VIDEO_TAG_MAX_COUNT = 20;
export const VIDEO_TAG_MAX_LENGTH = 40;
export const VIDEO_CHAPTER_MAX_COUNT = 100;
export const VIDEO_CHAPTER_TITLE_MAX_LENGTH = 100;

const languageSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      Intl.getCanonicalLocales(value);
      return true;
    } catch {
      return false;
    }
  }, "Use a valid BCP 47 language code, such as en or ar-EG.");

const tagSchema = z.string().trim().min(1).max(VIDEO_TAG_MAX_LENGTH);
const countrySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{2}$/.test(value), "Use two-letter country codes such as EG or US.");

const chapterSchema = z.object({
  title: z.string().trim().min(1).max(VIDEO_CHAPTER_TITLE_MAX_LENGTH),
  startSeconds: z.number().finite().int().min(0),
});

export const videoMetadataSchema = z
  .object({
    tags: z
      .array(tagSchema)
      .max(VIDEO_TAG_MAX_COUNT)
      .transform((tags) => {
        const seen = new Set<string>();
        return tags.filter((tag) => {
          const key = tag.toLocaleLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })
      .optional(),
    category: z
      .enum([
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
      ])
      .nullable()
      .optional(),
    primaryLanguage: languageSchema.nullable().optional(),
    recordingDate: z.string().date().nullable().optional(),
    contentType: z.enum(["VIDEO", "MOVIE", "DOCUMENTARY", "EXCLUSIVE", "PREMIUM", "OTHER"]).optional(),
    rightsBasis: z.enum(["AUTHORIZED", "PUBLIC_DOMAIN", "CREATOR_OWNED", "LICENSED"]).optional(),
    seriesTitle: z.string().trim().min(1).max(120).nullable().optional(),
    seasonNumber: z.number().int().min(1).max(10_000).nullable().optional(),
    episodeNumber: z.number().int().min(1).max(100_000).nullable().optional(),
    maturityLevel: z.enum(["GENERAL", "TEEN", "MATURE"]).nullable().optional(),
    geoAvailabilityMode: z.enum(["WORLDWIDE", "INCLUDE_ONLY", "EXCLUDE"]).nullable().optional(),
    geoCountries: z.array(countrySchema).max(50).optional(),
    chapters: z.array(chapterSchema).max(VIDEO_CHAPTER_MAX_COUNT).nullable().optional(),
    adBreakPreference: z.enum(["AUTOMATIC", "DISABLED"]).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.recordingDate && new Date(`${value.recordingDate}T00:00:00.000Z`).getTime() > Date.now()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recordingDate"],
        message: "Recording date cannot be in the future.",
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
  });

export type VideoMetadataInput = z.infer<typeof videoMetadataSchema>;

export function validateChapterDuration(input: VideoMetadataInput, durationMs: number | null): void {
  if (!input.chapters?.length || !durationMs) return;
  const durationSeconds = Math.ceil(durationMs / 1000);
  if (input.chapters.some((chapter) => chapter.startSeconds >= durationSeconds)) {
    throw new Error("CHAPTER_OUTSIDE_VIDEO");
  }
}

export function metadataData(input: VideoMetadataInput) {
  return {
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.primaryLanguage !== undefined
      ? {
          primaryLanguage: input.primaryLanguage
            ? Intl.getCanonicalLocales(input.primaryLanguage)[0]
            : null,
        }
      : {}),
    ...(input.recordingDate !== undefined
      ? { recordingDate: input.recordingDate ? new Date(`${input.recordingDate}T00:00:00.000Z`) : null }
      : {}),
    ...(input.seriesTitle !== undefined ? { seriesTitle: input.seriesTitle } : {}),
    ...(input.seasonNumber !== undefined ? { seasonNumber: input.seasonNumber } : {}),
    ...(input.episodeNumber !== undefined ? { episodeNumber: input.episodeNumber } : {}),
    ...(input.maturityLevel !== undefined ? { maturityLevel: input.maturityLevel } : {}),
    ...(input.geoAvailabilityMode !== undefined
      ? { geoAvailabilityMode: input.geoAvailabilityMode }
      : {}),
    ...(input.geoCountries !== undefined ? { geoCountries: [...new Set(input.geoCountries)] } : {}),
    ...(input.chapters !== undefined ? { chapters: input.chapters } : {}),
    ...(input.adBreakPreference !== undefined
      ? { adBreakPreference: input.adBreakPreference }
      : {}),
  };
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
    "maturityLevel",
    "geoAvailabilityMode",
    "geoCountries",
    "chapters",
    "adBreakPreference",
  ].some((key) => Object.prototype.hasOwnProperty.call(input, key));
}
