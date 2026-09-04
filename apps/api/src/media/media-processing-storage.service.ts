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
import { resolveMediaProcessingTimeouts } from "./media-processing-timeouts.js";
import { R2SigV4 } from "./r2-sigv4.js";

@Injectable()
export class MediaProcessingStorageService {
  private readonly r2MetadataTimeoutMs: number;
  private readonly r2TransferTimeoutMs: number;

  constructor(
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly config: MediaStorageConfig,
  ) {
    const timeouts = resolveMediaProcessingTimeouts();
    this.r2MetadataTimeoutMs = timeouts.r2MetadataMs;
    this.r2TransferTimeoutMs = timeouts.r2TransferMs;
  }

  async downloadToFile(key: string, destinationPath: string): Promise<void> {
    this.assertR2();
    await this.withDeadline("download", this.r2TransferTimeoutMs, async (signal) => {
      const response = await new R2SigV4(this.config).request({ method: "GET", key, signal });
      if (!response.body) {
        throw new Error("R2 returned an empty response body for the media source.");
      }
      const readable = Readable.fromWeb(response.body as WebReadableStream);
      await pipeline(readable, createWriteStream(destinationPath, { flags: "wx" }));
    });
  }

  async uploadFile(key: string, filePath: string, contentType = "video/mp4"): Promise<void> {
    this.assertR2();
    const authorization = await this.storage.authorizeSinglePut({
      key,
      contentType,
      expiresInSeconds: Math.max(300, this.config.uploadUrlTtlSeconds),
    });

    await this.withDeadline("upload", this.r2TransferTimeoutMs, async (signal) => {
      const source = createReadStream(filePath);
      try {
        const uploadBody = Readable.toWeb(source) as unknown as BodyInit;
        const response = await fetch(authorization.url, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: uploadBody,
          duplex: "half",
          signal,
        } as RequestInit & { duplex: "half" });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`R2 worker upload failed (${response.status}). ${detail}`.trim());
        }
      } finally {
        source.destroy();
      }
    });
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
    this.assertR2();
    return this.withDeadline("metadata request", this.r2MetadataTimeoutMs, async (signal) => {
      const response = await new R2SigV4(this.config).request({ method: "HEAD", key, signal });
      return {
        sizeBytes: Number(response.headers.get("content-length") ?? "0"),
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
      };
    });
  }

  async deleteObject(key: string): Promise<void> {
    this.assertR2();
    await this.withDeadline("delete request", this.r2MetadataTimeoutMs, async (signal) => {
      await new R2SigV4(this.config).request({ method: "DELETE", key, signal });
    });
  }

  private async withDeadline<T>(
    operation: string,
    timeoutMs: number,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
      return await work(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `R2 worker ${operation} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertR2(): void {
    if (!this.storage.available || this.storage.kind !== "r2" || this.config.mode !== "r2") {
      throw new MediaStorageUnavailableError();
    }
  }
}
