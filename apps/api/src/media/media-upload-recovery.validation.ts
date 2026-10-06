import { z } from "zod";
import {
  UPLOAD_FILE_IDENTITY_ALGORITHM,
  UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES,
  UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES,
} from "@ayin/types";
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
export const uploadFileIdentitySchema = z
  .object({
    algorithm: z.literal(UPLOAD_FILE_IDENTITY_ALGORITHM),
    version: z.literal(1),
    sizeBytes: z.number().int().min(1).max(UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES),
    chunkSizeBytes: z.literal(UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES),
    leafCount: z.number().int().min(1).max(12800),
    rootSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .refine(
    (value) => value.leafCount === Math.ceil(value.sizeBytes / value.chunkSizeBytes),
    "Invalid file identity leaf count.",
  );
export const createRecoverableDraftSchema = z
  .object({
    requestId: uuid,
    channelId: uuid,
    title: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().min(1).max(UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES),
    mimeType: z.string().trim().min(1).max(255),
    durationMs: z.number().int().positive().max(2147483647).nullable().optional(),
    videoForm: z.enum(["LONG_FORM", "CLIP"]).default("LONG_FORM"),
    fileIdentity: uploadFileIdentitySchema,
  })
  .strict()
  .refine(
    (value) => value.sizeBytes === value.fileIdentity.sizeBytes,
    "File identity byte count changed.",
  );
export const uploadRecoveryCommandSchema = z
  .object({ requestId: uuid, expectedRevision: z.number().int().min(1).max(2147483646) })
  .strict();
export const resumeUploadSchema = uploadRecoveryCommandSchema.extend({
  fileIdentity: uploadFileIdentitySchema,
});
export const authorizeRecoveredUploadSchema = uploadRecoveryCommandSchema.extend({
  partNumber: z.number().int().min(1).max(10000),
});
