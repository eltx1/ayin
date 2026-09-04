import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { MEDIA_STORAGE_CONFIG } from "./media-storage.adapter.js";
import type { MediaStorageConfig } from "./media-storage.config.js";

const payloadSchema = z.object({
  version: z.literal(1),
  accountId: z.string().uuid(),
  adminOverride: z.boolean().optional(),
  channelId: z.string().uuid(),
  assetId: z.string().uuid(),
  objectKey: z.string().min(1).max(1024),
  uploadId: z.string().min(1).nullable(),
  mode: z.enum(["single", "multipart"]),
  mimeType: z.enum(["video/mp4", "video/quicktime"]),
  sizeBytes: z.number().int().positive(),
  partSizeBytes: z.number().int().positive(),
  expiresAtMs: z.number().int().positive(),
});

export type UploadSessionPayload = z.infer<typeof payloadSchema>;

@Injectable()
export class UploadSessionTokenService {
  constructor(@Inject(MEDIA_STORAGE_CONFIG) private readonly config: MediaStorageConfig) {}

  sign(payload: UploadSessionPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${this.signature(encoded)}`;
  }

  verify(token: string): UploadSessionPayload {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) {
      throw new Error("Upload session is invalid.");
    }
    const expected = this.signature(encoded);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new Error("Upload session is invalid.");
    }
    const parsed = payloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
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
