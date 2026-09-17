import { z } from "zod";

const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,14}(?:\.\d{1,6})?$/);

const currencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());

export const revenueReportRowSchema = z
  .object({
    externalRowId: z.string().trim().min(1).max(160),
    grossAmount: moneySchema,
    channelId: z.string().uuid().optional(),
    channelHandle: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .transform((value) => value.replace(/^@/, ""))
      .optional(),
    videoId: z.string().uuid().optional(),
    videoSlug: z.string().trim().min(1).max(160).optional(),
    contentId: z.string().trim().min(1).max(200).optional(),
    adSource: z.string().trim().min(1).max(80).optional(),
    memo: z.string().trim().max(500).optional(),
  })
  .strict();

export const revenueReportImportSchema = z
  .object({
    source: z.string().trim().min(1).max(80),
    sourceReportId: z.string().trim().min(1).max(160),
    periodStart: z.string().datetime({ offset: true }),
    periodEnd: z.string().datetime({ offset: true }),
    currency: currencySchema,
    state: z.enum(["ESTIMATED", "FINAL"]),
    format: z.enum(["STRUCTURED", "CSV"]),
    rows: z.array(revenueReportRowSchema).min(1).max(5000).optional(),
    csv: z.string().min(1).max(5_000_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Date(value.periodEnd) <= new Date(value.periodStart)) {
      context.addIssue({
        code: "custom",
        message: "periodEnd must be after periodStart.",
        path: ["periodEnd"],
      });
    }
    if (value.format === "STRUCTURED" && !value.rows?.length) {
      context.addIssue({
        code: "custom",
        message: "Structured imports require rows.",
        path: ["rows"],
      });
    }
    if (value.format === "STRUCTURED" && value.csv !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Structured imports must not include csv.",
        path: ["csv"],
      });
    }
    if (value.format === "CSV" && !value.csv?.trim()) {
      context.addIssue({
        code: "custom",
        message: "CSV imports require csv content.",
        path: ["csv"],
      });
    }
    if (value.format === "CSV" && value.rows !== undefined) {
      context.addIssue({
        code: "custom",
        message: "CSV imports must not include structured rows.",
        path: ["rows"],
      });
    }
  });

export const revenueReconciliationReportQuerySchema = z.object({
  source: z.string().trim().min(1).max(80).optional(),
  status: z
    .enum(["MATCHED", "UNMATCHED", "DUPLICATE", "CORRECTED", "FINALIZED", "ANOMALOUS"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  take: z.coerce.number().int().min(1).max(100).default(25),
});

export type RevenueReportRowInput = z.infer<typeof revenueReportRowSchema>;
export type RevenueReportImportInput = z.infer<typeof revenueReportImportSchema>;
export type RevenueReconciliationStatus = z.infer<
  typeof revenueReconciliationReportQuerySchema
>["status"];
