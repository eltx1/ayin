import { z } from "zod";

const moneySchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,14}(?:\.\d{1,6})?$/);
const positiveMoneySchema = moneySchema.refine((value) => !value.startsWith("-"), {
  message: "Amount must be non-negative.",
});
const currencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());
const countryCodeSchema = z
  .string()
  .trim()
  .length(2)
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase());

export const revenueImportEntrySchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(160),
    channelId: z.string().uuid(),
    videoId: z.string().uuid().nullable().optional(),
    campaignId: z.string().uuid().nullable().optional(),
    adSource: z.string().trim().min(1).max(80).nullable().optional(),
    periodStart: z.string().datetime({ offset: true }),
    periodEnd: z.string().datetime({ offset: true }),
    grossAmount: positiveMoneySchema,
    currency: currencySchema,
    state: z.enum(["ESTIMATED", "FINAL"]),
    memo: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => new Date(value.periodEnd) > new Date(value.periodStart), {
    message: "periodEnd must be after periodStart.",
    path: ["periodEnd"],
  });

export const revenueImportSchema = z
  .object({
    source: z.string().trim().min(1).max(80),
    entries: z.array(revenueImportEntrySchema).min(1).max(500),
  })
  .strict();

export const contractOverrideSchema = z
  .object({
    revenueShareBps: z.number().int().min(0).max(10_000),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
    termsVersion: z.string().trim().min(1).max(80).nullable().optional(),
    status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "ENDED"]).default("ACTIVE"),
  })
  .strict()
  .refine(
    (value) => !value.effectiveTo || new Date(value.effectiveTo) > new Date(value.effectiveFrom),
    { message: "effectiveTo must be after effectiveFrom.", path: ["effectiveTo"] },
  );

export const adjustmentSchema = z
  .object({
    channelId: z.string().uuid(),
    amount: moneySchema.refine((value) => value !== "0" && value !== "0.0" && value !== "0.000000"),
    currency: currencySchema,
    reason: z.string().trim().min(8).max(500),
    videoId: z.string().uuid().nullable().optional(),
    campaignId: z.string().uuid().nullable().optional(),
    periodStart: z.string().datetime({ offset: true }).nullable().optional(),
    periodEnd: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export const payoutCreateSchema = z
  .object({
    channelId: z.string().uuid(),
    currency: currencySchema,
  })
  .strict();

export const creatorPayoutRequestSchema = z
  .object({
    currency: currencySchema.optional(),
  })
  .strict();

export const payoutStatusSchema = z
  .object({
    status: z.enum(["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED"]),
    externalReference: z.string().trim().max(255).nullable().optional(),
    failureReason: z.string().trim().max(1000).nullable().optional(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const revenueSettingsSchema = z
  .object({
    defaultCreatorRevenueShareBps: z.number().int().min(0).max(10_000),
    payoutThresholdMicros: z.string().regex(/^\d+$/),
  })
  .strict();

export const payoutProfileSchema = z
  .object({
    legalName: z.string().trim().min(2).max(160),
    preferredCurrency: currencySchema,
    provider: z.enum(["MANUAL", "BANK_TRANSFER", "PAYPAL", "PAYONEER", "WISE"]).default("MANUAL"),
    destination: z.string().trim().min(4).max(1500).optional(),
    countryCode: countryCodeSchema.nullable().optional(),
  })
  .strict();

export const revenueDisputeCreateSchema = z
  .object({
    category: z.enum(["EARNINGS", "PAYOUT", "OTHER"]),
    payoutId: z.string().uuid().nullable().optional(),
    message: z.string().trim().min(20).max(5000),
  })
  .strict();

export const revenueDisputeUpdateSchema = z
  .object({
    status: z.enum(["OPEN", "REVIEWING", "RESOLVED", "REJECTED"]),
    resolution: z.string().trim().min(8).max(5000).nullable().optional(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict()
  .refine(
    (value) => !["RESOLVED", "REJECTED"].includes(value.status) || Boolean(value.resolution),
    { message: "A resolution is required when closing a dispute.", path: ["resolution"] },
  );

export const ledgerQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
  videoId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  state: z.enum(["ESTIMATED", "FINAL", "ADJUSTMENT"]).optional(),
  currency: currencySchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(100).default(25),
});

export type RevenueImportInput = z.infer<typeof revenueImportSchema>;
export type ContractOverrideInput = z.infer<typeof contractOverrideSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type PayoutProfileInput = z.infer<typeof payoutProfileSchema>;
export type RevenueDisputeCreateInput = z.infer<typeof revenueDisputeCreateSchema>;
