import { z } from "zod";

export const communityPostInputSchema = z
  .object({
    type: z.enum(["TEXT", "IMAGE", "POLL", "VIDEO_SHARE"]),
    body: z.string().trim().max(5000).nullable().optional(),
    sharedVideoId: z.string().uuid().nullable().optional(),
    pollOptions: z.array(z.string().trim().min(1).max(160)).min(2).max(6).optional(),
    scheduledPublishAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export const communityCommentSchema = z
  .object({ body: z.string().trim().min(1).max(4000), parentId: z.string().uuid().optional() })
  .strict();
export const communityReportSchema = z
  .object({
    reason: z.enum([
      "COPYRIGHT",
      "SPAM",
      "HARASSMENT",
      "HATE",
      "SEXUAL_CONTENT",
      "VIOLENCE",
      "MISLEADING",
      "OTHER",
    ]),
    details: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type CommunityPostInput = z.infer<typeof communityPostInputSchema>;
