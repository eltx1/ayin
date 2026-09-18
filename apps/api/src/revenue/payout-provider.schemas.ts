import { z } from "zod";

export const verifyProviderDestinationSchema = z
  .object({
    destinationToken: z.string().trim().min(8).max(2000),
  })
  .strict();

export const providerActionReasonSchema = z
  .object({
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
