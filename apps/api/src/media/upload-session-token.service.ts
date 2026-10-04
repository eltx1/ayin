import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { MEDIA_STORAGE_CONFIG } from "./media-storage.adapter.js";
import type { MediaStorageConfig } from "./media-storage.config.js";

export const MAX_UPLOAD_SESSION_TOKEN_LENGTH = 16 * 1024;

const payloadSchema = z
  .object({
    version: z.literal(1),
    accountId: z.string().uuid(),
    adminOverride: z.boolean().optional(),
    channelId: z.string().uuid(),
    assetId: z.string().uuid(),
    objectKey: z.string().min(1).max(1024),
    uploadId: z.string().min(1).max(1024).nullable(),
    mode: z.enum(["single", "multipart"]),
    mimeType: z.enum([
      "video/mp4",
      "video/quicktime",
      "video/x-matroska",
      "video/webm",
      "video/x-msvideo",
      "video/mpeg",
      "video/mp2t",
      "video/3gpp",
      "video/3gpp2",
      "video/x-m4v",
      "video/x-ms-wmv",
      "video/x-flv",
      "video/ogg",
      "application/mxf",
    ]),
    sizeBytes: z.number().int().safe().positive(),
    partSizeBytes: z.number().int().safe().positive(),
    expiresAtMs: z.number().int().safe().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.mode === "single" && value.uploadId !== null) ||
      (value.mode === "multipart" && value.uploadId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["uploadId"],
        message: "Upload mode and multipart ID disagree.",
      });
    }
  });

export type UploadSessionPayload = z.infer<typeof payloadSchema>;

@Injectable()
export class UploadSessionTokenService {
  constructor(@Inject(MEDIA_STORAGE_CONFIG) private readonly config: MediaStorageConfig) {}

  sign(payload: UploadSessionPayload): string {
    const parsed = payloadSchema.parse(payload);
    const encoded = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    const token = `${encoded}.${this.signature(encoded)}`;
    if (token.length > MAX_UPLOAD_SESSION_TOKEN_LENGTH)
      throw new Error("Upload session is invalid.");
    return token;
  }

  verify(token: string): UploadSessionPayload {
    if (typeof token !== "string" || token.length > MAX_UPLOAD_SESSION_TOKEN_LENGTH) {
      throw new Error("Upload session is invalid.");
    }
    const segments = token.split(".");
    const [encoded, signature] = segments;
    if (
      segments.length !== 2 ||
      !encoded ||
      !signature ||
      !/^[A-Za-z0-9_-]+$/.test(encoded) ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature)
    ) {
      throw new Error("Upload session is invalid.");
    }
    const expected = this.signature(encoded);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new Error("Upload session is invalid.");
    }
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error("Upload session is invalid.");
    const parsed = payloadSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (parsed.expiresAtMs <= Date.now()) {
      throw new Error("Upload session expired.");
    }
    return parsed;
  }

  private signature(value: string): string {
    return createHmac("sha256", this.config.uploadSessionSecret).update(value).digest("base64url");
  }
}
