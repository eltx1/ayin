import { HttpException } from "@nestjs/common";
import { z } from "zod";

import { advertiserCreateSchema, campaignCreateSchema } from "./direct-ad.schemas.js";

const mutationId = z.string().uuid().optional();
const expectedUpdatedAt = z.string().datetime({ offset: true }).optional();
const versionFields = { mutationId, expectedUpdatedAt };
const requireVersion = <
  T extends { mutationId?: string | undefined; expectedUpdatedAt?: string | undefined },
>(
  data: T,
) => !data.mutationId || data.expectedUpdatedAt !== undefined;
const versionIssue = {
  message: "A workspace mutation requires the reviewed version.",
  path: ["expectedUpdatedAt"],
};

export const advertiserCreateWriteSchema = advertiserCreateSchema.extend({ mutationId }).strict();
// Optional patches must not apply create defaults for fields absent from the
// command. Zod 4 applies defaults even inside partial() object schemas.
export const advertiserPatchWriteSchema = z
  .object({
    name: advertiserCreateSchema.shape.name.optional(),
    status: advertiserCreateSchema.shape.status.removeDefault().optional(),
    ...versionFields,
  })
  .strict()
  .refine(requireVersion, versionIssue);
export const advertisingDeleteWriteSchema = z
  .object(versionFields)
  .strict()
  .refine(requireVersion, versionIssue);
export const campaignCreateWriteSchema = campaignCreateSchema
  .extend({
    mutationId,
    expectedAdvertiserUpdatedAt: expectedUpdatedAt,
  })
  .strict()
  .refine((data) => !data.mutationId || data.expectedAdvertiserUpdatedAt !== undefined, {
    message: "A workspace campaign requires the reviewed advertiser version.",
    path: ["expectedAdvertiserUpdatedAt"],
  });
export const campaignPatchWriteSchema = z
  .object({
    name: campaignCreateSchema.shape.name.optional(),
    status: campaignCreateSchema.shape.status.removeDefault().optional(),
    startsAt: campaignCreateSchema.shape.startsAt.removeDefault().optional(),
    endsAt: campaignCreateSchema.shape.endsAt.removeDefault().optional(),
    budget: campaignCreateSchema.shape.budget.removeDefault().optional(),
    currency: campaignCreateSchema.shape.currency.removeDefault().optional(),
    direct: campaignCreateSchema.shape.direct.optional(),
    ...versionFields,
  })
  .strict()
  .refine(requireVersion, versionIssue);

export const advertisingActions = [
  "ADVERTISER_CREATED",
  "ADVERTISER_UPDATED",
  "ADVERTISER_DELETED",
  "CAMPAIGN_CREATED",
  "CAMPAIGN_UPDATED",
  "CAMPAIGN_DELETED",
] as const;
export type AdvertisingAction = (typeof advertisingActions)[number];
export type AdvertisingAcknowledgment = {
  mutationId: string;
  actorAccountId: string;
  action: AdvertisingAction;
  entityType: "Advertiser" | "Campaign";
  entityId: string;
  updatedAt: string;
};

export function advertisingError(status: number, code: string, message: string) {
  return new HttpException({ error: { code, message } }, status);
}

export function assertAdvertisingVersion(current: Date, expected?: string) {
  if (expected !== undefined && current.getTime() !== new Date(expected).getTime())
    throw advertisingError(
      409,
      "ADVERTISING_VERSION_CONFLICT",
      "This record changed. Read it again before reviewing a new operation.",
    );
}

// PostgreSQL timestamps are millisecond precision. Wall-clock equality or an
// older local clock must never let a second write reuse an observed version.
export function nextAdvertisingVersion(previous: Date) {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}
