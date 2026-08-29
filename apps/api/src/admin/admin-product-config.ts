import { z } from "zod";

export const homeRowSourceSchema = z.enum([
  "CONTINUE_WATCHING",
  "TRENDING_WORLDWIDE",
  "POPULAR_NOW",
  "NEW_ON_AYIN",
  "BECAUSE_YOU_WATCHED",
  "POPULAR_REGION",
  "MOVIES",
  "SERIES",
  "CREATOR_TV",
  "CREATORS_YOU_FOLLOW",
  "RECENTLY_ADDED",
  "EDITOR_PICKS",
]);

export const homeRowAudienceSchema = z.enum(["ALL", "AUTHENTICATED", "ANONYMOUS"]);
export const manualItemTypeSchema = z.enum(["VIDEO", "CREATOR_TV", "CHANNEL", "PLAYLIST"]);

export const homeRowPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  source: homeRowSourceSchema.optional(),
  audience: homeRowAudienceSchema.optional(),
  enabled: z.boolean().optional(),
  maxItems: z.number().int().min(1).max(100).optional(),
  regionPersonalizationRequired: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500),
});

export const reorderHomeRowsSchema = z.object({
  rowIds: z.array(z.string().uuid()).min(1).max(100),
  reason: z.string().trim().min(3).max(500),
});

export const manualItemsSchema = z.object({
  items: z
    .array(
      z.object({
        entityType: manualItemTypeSchema,
        entityId: z.string().uuid(),
      }),
    )
    .max(100),
  reason: z.string().trim().min(3).max(500),
});

export const navigationItemSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/).max(40),
  label: z.string().trim().min(1).max(60),
  href: z.string().startsWith("/").max(160),
  enabled: z.boolean(),
  featureFlag: z.string().trim().max(120).nullable().default(null),
});

export const taxonomyItemSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/).max(60),
  label: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
});

export const productControlsSchema = z.object({
  navigation: z.array(navigationItemSchema).min(1).max(24),
  hero: z.object({
    entityType: manualItemTypeSchema.nullable(),
    entityId: z.string().uuid().nullable(),
  }),
  taxonomy: z.array(taxonomyItemSchema).max(100),
  announcement: z.object({
    enabled: z.boolean(),
    text: z.string().trim().max(240),
    href: z.string().startsWith("/").max(160).nullable(),
  }),
  deviceVisibility: z.object({
    web: z.boolean(),
    mobile: z.boolean(),
    tv: z.boolean(),
  }),
});

export const updateProductControlsSchema = productControlsSchema.extend({
  reason: z.string().trim().min(3).max(500),
});

export type HomeRowPatch = z.infer<typeof homeRowPatchSchema>;
export type ProductControls = z.infer<typeof productControlsSchema>;
export type UpdateProductControls = z.infer<typeof updateProductControlsSchema>;

export const defaultProductControls: ProductControls = {
  navigation: [
    { key: "home", label: "Home", href: "/", enabled: true, featureFlag: null },
    { key: "movies", label: "Movies", href: "/movies", enabled: true, featureFlag: "movies" },
    { key: "series", label: "Series", href: "/series", enabled: true, featureFlag: "series" },
    { key: "tv", label: "TV", href: "/tv", enabled: true, featureFlag: null },
    { key: "creators", label: "Creators", href: "/creators", enabled: true, featureFlag: null },
    { key: "shorts", label: "Shorts / Clips", href: "/shorts", enabled: false, featureFlag: "shorts" },
    { key: "kids", label: "Kids", href: "/kids", enabled: false, featureFlag: "kids" },
    { key: "my-ayin", label: "My AYIN", href: "/my-ayin", enabled: true, featureFlag: null },
    { key: "search", label: "Search", href: "/search", enabled: true, featureFlag: null },
  ],
  hero: { entityType: null, entityId: null },
  taxonomy: [],
  announcement: { enabled: false, text: "", href: null },
  deviceVisibility: { web: true, mobile: true, tv: true },
};
