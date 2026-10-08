import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES } from "@ayin/types";
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
import {
  MediaOutputWriteJournalService,
  type MediaOutputWriteContext,
} from "./media-output-write-journal.js";
import { R2SigV4 } from "./r2-sigv4.js";

@Injectable()
export class MediaProcessingStorageService {
  private readonly r2MetadataTimeoutMs: number;
  private readonly r2TransferTimeoutMs: number;

  constructor(
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly config: MediaStorageConfig,
    @Inject(MediaOutputWriteJournalService)
    private readonly outputWrites?: MediaOutputWriteJournalService,
  ) {
    const timeouts = resolveMediaProcessingTimeouts();
    this.r2MetadataTimeoutMs = timeouts.r2MetadataMs;
    this.r2TransferTimeoutMs = timeouts.r2TransferMs;
  }

  async downloadToFile(
    key: string,
    destinationPath: string,
    options?: { exactSizeBytes: number; signal?: AbortSignal },
  ): Promise<void> {
    this.assertR2();
    if (
      options &&
      (!Number.isSafeInteger(options.exactSizeBytes) ||
        options.exactSizeBytes < 1 ||
        options.exactSizeBytes > UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES)
    )
      throw new Error("The exact media download byte limit is invalid.");
    await this.withDeadline("download", this.r2TransferTimeoutMs, async (deadline) => {
      const signal = options?.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
      signal.throwIfAborted();
      const response = await new R2SigV4(this.config).request({ method: "GET", key, signal });
      if (!response.body)
        throw new Error("R2 returned an empty response body for the media source.");
      if (options) {
        await downloadExactFile(response, destinationPath, options.exactSizeBytes, signal);
      } else {
        // Preserve the existing legacy contract. Required-input/canonical
        // callers opt into the immutable exact-byte scratch bound below.
        const readable = Readable.fromWeb(response.body as WebReadableStream);
        await pipeline(readable, createWriteStream(destinationPath, { flags: "wx" }));
      }
    });
  }

  async downloadText(key: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
    this.assertR2();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 8 * 1024 * 1024) {
      throw new Error("R2 text verification limit is outside the safe range.");
    }
    return this.withDeadline("text download", this.r2TransferTimeoutMs, async (signal) => {
      const response = await new R2SigV4(this.config).request({ method: "GET", key, signal });
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error("R2 text object exceeds the verification size limit.");
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        throw new Error("R2 text object exceeds the verification size limit.");
      }
      return text;
    });
  }

  async uploadFile(
    key: string,
    filePath: string,
    contentType = "video/mp4",
    context?: MediaOutputWriteContext,
  ): Promise<void> {
    this.assertR2();
    // Required output namespaces may never use the legacy unjournaled path.
    // Dependency injection requires the journal in production; the optional TS
    // parameter only preserves direct legacy service/test construction.
    if (
      (!context && /\/playback\/g[1-9][0-9]*\/attempts\//.test(key)) ||
      (context && !this.outputWrites)
    )
      throw new Error("The immutable output PUT requires its write-ahead journal and claim.");
    const fileMetadata = await stat(filePath);
    if (
      !fileMetadata.isFile() ||
      !Number.isSafeInteger(fileMetadata.size) ||
      fileMetadata.size <= 0
    ) {
      throw new Error("The canonical media file is empty or unreadable before R2 upload.");
    }

    const dispatch = context
      ? await this.outputWrites!.dispatch({
          ...context,
          objectKey: key,
          expectedSizeBytes: fileMetadata.size,
          contentType,
        })
      : null;
    try {
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
            headers: {
              "content-type": contentType,
              "content-length": String(fileMetadata.size),
            },
            body: uploadBody,
            duplex: "half",
            signal,
          } as RequestInit & { duplex: "half" });
          if (response.status !== 200) {
            const detail = await response.text().catch(() => "");
            throw new Error(`R2 worker upload failed (${response.status}). ${detail}`.trim());
          }
        } finally {
          source.destroy();
        }
      });
      // Only this exact PUT's successful provider response is evidence. A HEAD,
      // local timeout, abort, retry or missing object is not an acknowledgement.
      if (dispatch) await this.outputWrites!.acknowledge(dispatch);
    } catch (error) {
      // If the database is unavailable, the original DISPATCHED row survives
      // as debt. Neither this method nor the journal retries the provider PUT.
      if (dispatch) await this.outputWrites!.markUnknown(dispatch).catch(() => undefined);
      throw error;
    }
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
    this.assertR2();
    return this.withDeadline("metadata request", this.r2MetadataTimeoutMs, async (signal) => {
      const response = await new R2SigV4(this.config).request({ method: "HEAD", key, signal });
      const length = response.headers.get("content-length");
      const sizeBytes = Number(length);
      if (length === null || !/^\d+$/.test(length) || !Number.isSafeInteger(sizeBytes)) {
        throw new Error("R2 returned invalid object size metadata.");
      }
      return {
        sizeBytes,
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

async function downloadExactFile(
  response: Response,
  path: string,
  exactSizeBytes: number,
  signal: AbortSignal,
) {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let readable: Readable | undefined;
  let completed = false;
  try {
    signal.throwIfAborted();
    const declared = response.headers.get("content-length");
    if (
      declared !== null &&
      (!/^\d+$/.test(declared) ||
        !Number.isSafeInteger(Number(declared)) ||
        Number(declared) !== exactSizeBytes)
    )
      throw new Error("R2 Content-Length does not match the exact media byte size.");
    // Exclusive open establishes ownership before any removal on failure. Never
    // delete an existing file when opening it failed with EEXIST.
    file = await open(path, "wx");
    signal.throwIfAborted();
    let observed = 0;
    const bound = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        if (!(chunk instanceof Uint8Array) || observed + chunk.byteLength > exactSizeBytes) {
          callback(new Error("R2 media stream exceeds its exact byte size."));
          return;
        }
        observed += chunk.byteLength;
        callback(null, chunk);
      },
    });
    readable = Readable.fromWeb(response.body as WebReadableStream);
    await pipeline(readable, bound, file.createWriteStream(), { signal });
    if (observed !== exactSizeBytes)
      throw new Error("R2 media stream ended before its exact byte size.");
    completed = true;
  } finally {
    if (readable) readable.destroy();
    else if (response.body) void response.body.cancel().catch(() => undefined);
    await file?.close().catch(() => undefined);
    if (file && !completed) await rm(path, { force: true });
  }
}
