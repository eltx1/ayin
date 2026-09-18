import { z } from "zod";

export const creatorComplianceStepSchema = z
  .object({
    step: z.enum(["IDENTITY", "TAX"]),
  })
  .strict();

export const adminComplianceOverrideSchema = z
  .object({
    field: z.enum(["IDENTITY", "TAX", "PAYOUT_DESTINATION"]),
    status: z.enum(["NOT_STARTED", "PENDING", "VERIFIED", "REQUIRES_ACTION", "REJECTED"]),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
