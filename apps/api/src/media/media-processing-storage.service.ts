import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { Inject, Injectable } from "@nestjs/common";

import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type MediaStorageAdapter,
  MediaStorageUnavailableError,
  type StoredObjectMetadata,
} from "./media-storage.adapter.js";
import type { MediaStorageConfig } from "./media-storage.config.js";
import { R2SigV4 } from "./r2-sigv4.js";

@Injectable()
export class MediaProcessingStorageService {
  constructor(
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly config: MediaStorageConfig,
  ) {}

  async downloadToFile(key: string, destinationPath: string): Promise<void> {
    this.assertR2();
    const response = await new R2SigV4(this.config).request({ method: "GET", key });
    if (!response.body) throw new Error("R2 returned an empty response body for the media source.");
    const readable = Readable.fromWeb(response.body as WebReadableStream);
    await pipeline(readable, createWriteStream(destinationPath, { flags: "wx" }));
  }

  async uploadFile(key: string, filePath: string, contentType = "video/mp4"): Promise<void> {
    this.assertR2();
    const authorization = await this.storage.authorizeSinglePut({
      key,
      contentType,
      expiresInSeconds: Math.max(300, this.config.uploadUrlTtlSeconds),
    });
    const uploadBody = Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit;
    const response = await fetch(authorization.url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: uploadBody,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`R2 worker upload failed (${response.status}). ${detail}`.trim());
    }
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
    this.assertR2();
    return this.storage.headObject(key);
  }

  async deleteObject(key: string): Promise<void> {
    this.assertR2();
    await this.storage.deleteObject(key);
  }

  private assertR2(): void {
    if (!this.storage.available || this.storage.kind !== "r2" || this.config.mode !== "r2") {
      throw new MediaStorageUnavailableError();
    }
  }
}
