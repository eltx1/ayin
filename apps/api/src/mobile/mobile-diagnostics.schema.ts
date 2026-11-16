import { z } from "zod";
import { mobileVersionSchema } from "./mobile.schemas.js";

export const mobileDiagnosticCapabilities = [
  "privacy",
  "analytics",
  "ads.gam",
  "ads.webview",
  "ads.banner",
  "ads.interstitial",
  "notifications",
  "session.reset",
  "share",
  "media.pip",
  "upload.recovery",
  "upload.sources",
] as const;
export const mobileDiagnosticStatuses = [
  "DISABLED",
  "READY",
  "CONSENT_REQUIRED",
  "RESTRICTED",
  "CONFIG_UNAVAILABLE",
  "UNSUPPORTED",
  "NO_FILL",
  "TIMEOUT",
  "FAILED",
] as const;
const timestamp = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => Date.parse(value) <= Date.now() + 5 * 60_000,
    "Diagnostic timestamp cannot be more than five minutes in the future.",
  )
  .nullable();
/** Deliberately excludes arbitrary text, URLs, units, tokens and identity parameters. */
export const mobileDiagnosticSchema = z
  .object({
    installationId: z.string().uuid(),
    platform: z.enum(["android", "ios"]),
    appVersion: mobileVersionSchema,
    bridgeVersion: z.literal(1),
    capabilities: z
      .array(z.enum(mobileDiagnosticCapabilities))
      .max(mobileDiagnosticCapabilities.length)
      .refine((values) => new Set(values).size === values.length),
    configRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    configAppliedAt: timestamp,
    lastConfigCheckAt: timestamp,
    ads: z
      .object({
        status: z.enum(mobileDiagnosticStatuses),
        lastEvent: z.enum([
          "none",
          "ad_request",
          "ad_loaded",
          "ad_failed",
          "ad_shown",
          "ad_dismissed",
        ]),
        errorCode: z.number().int().min(0).max(9999).nullable(),
      })
      .strict(),
    firebaseConfigured: z.boolean(),
    runtimeAllowed: z.boolean(),
    diagnosticsConsent: z.literal(true),
  })
  .strict();
export type MobileDiagnosticInput = z.infer<typeof mobileDiagnosticSchema>;
