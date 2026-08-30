import { z } from "zod";
const uuid = z.string().uuid();
export const reportSchema = z
  .object({
    videoId: uuid.optional(),
    commentId: uuid.optional(),
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
    details: z.string().max(4000).optional(),
  })
  .refine(
    (v) => Number(Boolean(v.videoId)) + Number(Boolean(v.commentId)) === 1,
    "Exactly one report target is required",
  );
export const takedownSchema = z.object({
  videoId: uuid.optional(),
  claimantName: z.string().trim().min(2).max(160),
  contactEmail: z.string().email().max(320),
  rightsBasis: z.string().trim().min(2).max(120),
  details: z.string().trim().min(20).max(10000),
});
export const appealSchema = z.object({
  actionId: uuid,
  message: z.string().trim().min(20).max(5000),
});
export const actionSchema = z.object({
  caseId: uuid.optional(),
  targetAccountId: uuid.optional(),
  channelId: uuid.optional(),
  videoId: uuid.optional(),
  kind: z.enum([
    "WARN",
    "STRIKE",
    "SUSPEND_ACCOUNT",
    "SUSPEND_CHANNEL",
    "UNPUBLISH_VIDEO",
    "REMOVE_VIDEO",
  ]),
  reason: z.string().trim().min(10).max(4000),
});
export const appealDecisionSchema = z.object({
  status: z.enum(["REVIEWING", "UPHELD", "OVERTURNED"]),
  resolution: z.string().trim().min(10).max(4000),
});
export const trustSchema = z.object({
  level: z.enum(["NEW", "STANDARD", "TRUSTED", "RESTRICTED"]),
  reviewRequired: z.boolean().optional(),
});
export const settingsSchema = z.object({
  blockedTerms: z.array(z.string().trim().min(1).max(100)).max(500),
  newCreatorsRequireReview: z.boolean(),
});
export const caseSchema = z.object({
  status: z.enum(["OPEN", "REVIEWING", "ACTIONED", "DISMISSED", "CLOSED"]),
  resolution: z.string().trim().max(4000).optional(),
});
export const takedownDecisionSchema = z.object({
  status: z.enum(["REVIEWING", "ACTIONED", "DISMISSED"]),
  resolution: z.string().trim().min(10).max(4000),
});
