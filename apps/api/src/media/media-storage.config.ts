import { z } from "zod";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const environmentSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  R2_ACCOUNT_ID: z.string().trim().min(1).optional(),
  R2_BUCKET: z.string().trim().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
  R2_REGION: z.string().trim().min(1).default("auto"),
  R2_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  R2_PART_SIZE_BYTES: z.coerce.number().int().min(5 * MIB).max(5 * GIB).default(16 * MIB),
  R2_MULTIPART_THRESHOLD_BYTES: z.coerce
    .number()
    .int()
    .min(5 * MIB)
    .max(5 * GIB)
    .default(64 * MIB),
  UPLOAD_SESSION_SECRET: z.string().min(32).optional(),
});

export interface MediaStorageConfig {
  mode: "r2" | "development";
  appEnv: "development" | "test" | "staging" | "production";
  accountId: string | null;
  bucket: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  region: string;
  endpoint: string | null;
  uploadUrlTtlSeconds: number;
  partSizeBytes: number;
  multipartThresholdBytes: number;
  uploadSessionSecret: string;
}

export function loadMediaStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MediaStorageConfig {
  const parsed = environmentSchema.parse(environment);
  const credentialValues = [
    parsed.R2_ACCOUNT_ID,
    parsed.R2_BUCKET,
    parsed.R2_ACCESS_KEY_ID,
    parsed.R2_SECRET_ACCESS_KEY,
  ];
  const configuredCount = credentialValues.filter(Boolean).length;

  if (configuredCount > 0 && configuredCount !== credentialValues.length) {
    throw new Error(
      "R2 configuration is incomplete. Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY together.",
    );
  }

  const hasR2 = configuredCount === credentialValues.length;
  const uploadSessionSecret =
    parsed.UPLOAD_SESSION_SECRET ??
    (parsed.APP_ENV === "production"
      ? null
      : "ayin-development-upload-session-secret-not-for-production");

  if (hasR2 && !uploadSessionSecret) {
    throw new Error("UPLOAD_SESSION_SECRET is required when R2 uploads are enabled in production.");
  }

  return {
    mode: hasR2 ? "r2" : "development",
    appEnv: parsed.APP_ENV,
    accountId: parsed.R2_ACCOUNT_ID ?? null,
    bucket: parsed.R2_BUCKET ?? null,
    accessKeyId: parsed.R2_ACCESS_KEY_ID ?? null,
    secretAccessKey: parsed.R2_SECRET_ACCESS_KEY ?? null,
    region: parsed.R2_REGION,
    endpoint: parsed.R2_ACCOUNT_ID
      ? `https://${parsed.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : null,
    uploadUrlTtlSeconds: parsed.R2_UPLOAD_URL_TTL_SECONDS,
    partSizeBytes: parsed.R2_PART_SIZE_BYTES,
    multipartThresholdBytes: parsed.R2_MULTIPART_THRESHOLD_BYTES,
    uploadSessionSecret:
      uploadSessionSecret ?? "ayin-disabled-production-upload-session-secret-placeholder",
  };
}
