import type { MediaStorageConfig } from "./media-storage.config.js";
import {
  MediaStorageObservationError,
  type MediaStorageObservationCode,
  type AbandonedMultipartUpload,
  type CompletedUploadPart,
  type ExistingUploadPart,
  type MediaStorageAdapter,
  type StoredObjectMetadata,
  type UploadCompletionObservation,
  type UploadCompletionObservationInput,
  type UploadObjectBinding,
} from "./media-storage.adapter.js";
import { R2HttpError, R2SigV4 } from "./r2-sigv4.js";
import {
  matchUploadCompletionObject,
  objectMetadataFromHeaders,
  R2UploadMetadataError,
  uploadBindingHeaders,
  validateUploadCompletionExpectation,
} from "./r2-upload-completion.js";
import {
  parseR2Xml,
  readR2XmlText,
  R2XmlError,
  xmlField,
  xmlFields,
  type R2XmlNode,
} from "./r2-xml.js";

const LIST_PAGE_SIZE = 1000;
const MAX_LIST_ITEMS = 10000;
const MAX_LIST_PAGES = 100;
const MAX_LIST_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_LIST_TOTAL_BYTES = 32 * 1024 * 1024;
const LIST_DEADLINE_MS = 30000;
const MULTIPART_RESPONSE_BYTES = 64 * 1024;
const MULTIPART_DEADLINE_MS = 30000;

function integerField(node: R2XmlNode, name: string, min: number, max: number): number {
  const raw = xmlField(node, name)?.trim() ?? "";
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
    throw new R2XmlError();
  return value;
}

function boundedText(value: string | null, maxBytes: number, allowEmpty = false): string {
  if (value === null || (!allowEmpty && !value.trim()) || Buffer.byteLength(value) > maxBytes)
    throw new R2XmlError();
  return value;
}

function truncated(node: R2XmlNode): boolean {
  const value = xmlField(node, "IsTruncated")?.trim();
  if (value !== "true" && value !== "false") throw new R2XmlError();
  return value === "true";
}

function decodedKey(value: string | null, allowEmpty = false): string {
  try {
    return boundedText(decodeURIComponent(boundedText(value, 3072, allowEmpty)), 1024, allowEmpty);
  } catch {
    throw new R2XmlError();
  }
}

function initiatedDate(value: string | null): Date {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value))
    throw new R2XmlError();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19))
    throw new R2XmlError();
  return date;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function multipartToken(value: string | null, maxBytes: number): string {
  const token = boundedText(value, maxBytes);
  for (const character of token) {
    const code = character.codePointAt(0)!;
    if (
      code <= 0x20 ||
      code === 0x7f ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      throw new R2XmlError();
  }
  return token;
}

function normalizeEtag(value: string): string {
  const trimmed = boundedText(value, 256).trim();
  const contents =
    trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  if (contents.includes('"')) throw new R2XmlError();
  return `"${multipartToken(contents, 254)}"`;
}

export class R2MediaStorageAdapter implements MediaStorageAdapter {
  readonly kind = "r2" as const;
  readonly available = true;
  private readonly signer: R2SigV4;

  constructor(private readonly config: MediaStorageConfig) {
    this.signer = new R2SigV4(config);
  }

  async createMultipartUpload(input: {
    key: string;
    contentType: string;
    uploadBinding?: UploadObjectBinding;
  }): Promise<{ uploadId: string }> {
    boundedText(input.key, 1024);
    const root = await this.requestMultipartXml({
      key: input.key,
      query: [["uploads", ""]],
      contentType: input.contentType,
      ...(input.uploadBinding
        ? { metadataHeaders: uploadBindingHeaders(input.uploadBinding) }
        : {}),
    });
    if (root.name !== "InitiateMultipartUploadResult") throw new R2XmlError();
    xmlFields(root, ["Bucket", "Key", "UploadId"]);
    if (xmlField(root, "Bucket") !== this.config.bucket || xmlField(root, "Key") !== input.key)
      throw new R2XmlError();
    const uploadId = multipartToken(xmlField(root, "UploadId"), 1024);
    return { uploadId };
  }

  async authorizeMultipartPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expectedSizeBytes?: number;
    expiresInSeconds: number;
    now?: Date;
  }): Promise<{ url: string; expiresAt: Date }> {
    if (
      input.expectedSizeBytes !== undefined &&
      (!Number.isSafeInteger(input.expectedSizeBytes) ||
        input.expectedSizeBytes < 1 ||
        input.expectedSizeBytes > 5 * 1024 ** 3)
    )
      throw new Error("Invalid exact multipart body length.");
    return this.signer.presign({
      method: "PUT",
      key: input.key,
      query: [
        ["partNumber", String(input.partNumber)],
        ["uploadId", input.uploadId],
      ],
      ...(input.expectedSizeBytes !== undefined ? { contentLength: input.expectedSizeBytes } : {}),
      expiresInSeconds: input.expiresInSeconds,
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async authorizeSinglePut(input: {
    key: string;
    contentType: string;
    uploadBinding?: UploadObjectBinding;
    expiresInSeconds: number;
    now?: Date;
  }): Promise<{ url: string; expiresAt: Date }> {
    return this.signer.presign({
      method: "PUT",
      key: input.key,
      contentType: input.contentType,
      ...(input.uploadBinding
        ? { metadataHeaders: uploadBindingHeaders(input.uploadBinding) }
        : {}),
      expiresInSeconds: input.expiresInSeconds,
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async listParts(input: { key: string; uploadId: string }): Promise<ExistingUploadPart[]> {
    return this.observe("listParts", (page) => this.readParts(input, page));
  }

  private async readParts(
    input: { key: string; uploadId: string },
    page: (input: { key?: string; query: Array<[string, string]> }) => Promise<R2XmlNode>,
  ): Promise<ExistingUploadPart[]> {
    boundedText(input.key, 1024);
    boundedText(input.uploadId, 1024);
    const parts: ExistingUploadPart[] = [];
    let marker = 0;
    for (let index = 0; index < MAX_LIST_PAGES; index++) {
      const query: Array<[string, string]> = [
        ["uploadId", input.uploadId],
        ["max-parts", String(LIST_PAGE_SIZE)],
      ];
      if (marker) query.push(["part-number-marker", String(marker)]);
      const root = await page({ key: input.key, query });
      if (root.name !== "ListPartsResult") throw new R2XmlError();
      xmlFields(root, [
        "Bucket",
        "Key",
        "UploadId",
        "PartNumberMarker",
        "NextPartNumberMarker",
        "MaxParts",
        "IsTruncated",
        "Part",
        "Initiator",
        "Owner",
        "StorageClass",
        "ChecksumAlgorithm",
        "ChecksumType",
      ]);
      if (
        xmlField(root, "Bucket") !== this.config.bucket ||
        xmlField(root, "Key") !== input.key ||
        xmlField(root, "UploadId") !== input.uploadId ||
        integerField(root, "PartNumberMarker", 0, MAX_LIST_ITEMS) !== marker
      )
        throw new R2XmlError();
      const limit = integerField(root, "MaxParts", 1, LIST_PAGE_SIZE);
      const rows = root.children.filter((child) => child.name === "Part");
      if (rows.length > limit) throw new R2XmlError();
      let last = marker;
      for (const row of rows) {
        xmlFields(row, [
          "PartNumber",
          "ETag",
          "Size",
          "LastModified",
          "ChecksumCRC32",
          "ChecksumCRC32C",
          "ChecksumCRC64NVME",
          "ChecksumMD5",
          "ChecksumSHA1",
          "ChecksumSHA256",
        ]);
        const partNumber = integerField(row, "PartNumber", 1, MAX_LIST_ITEMS);
        if (partNumber <= last) throw new R2XmlError();
        last = partNumber;
        parts.push({
          partNumber,
          etag: boundedText(xmlField(row, "ETag"), 256),
          sizeBytes: integerField(row, "Size", 0, 5 * 1024 ** 3),
        });
      }
      const more = truncated(root);
      const next = xmlField(root, "NextPartNumberMarker", false);
      if (next !== null) integerField(root, "NextPartNumberMarker", 0, MAX_LIST_ITEMS);
      if (!more) return parts;
      if (!rows.length || next === null || Number(next) !== last || last <= marker)
        throw new R2XmlError();
      if (parts.length >= MAX_LIST_ITEMS || last >= MAX_LIST_ITEMS) throw new R2XmlError(true);
      marker = last;
    }
    throw new R2XmlError(true);
  }

  async completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: CompletedUploadPart[];
  }): Promise<{ etag: string | null }> {
    boundedText(input.key, 1024);
    multipartToken(input.uploadId, 1024);
    if (!input.parts.length || input.parts.length > MAX_LIST_ITEMS) throw new R2XmlError();
    const partNumbers = new Set<number>();
    const body = `<CompleteMultipartUpload>${[...input.parts]
      .sort((left, right) => left.partNumber - right.partNumber)
      .map((part) => {
        if (
          !Number.isSafeInteger(part.partNumber) ||
          part.partNumber < 1 ||
          part.partNumber > MAX_LIST_ITEMS ||
          partNumbers.has(part.partNumber)
        )
          throw new R2XmlError();
        partNumbers.add(part.partNumber);
        return `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(normalizeEtag(part.etag))}</ETag></Part>`;
      })
      .join("")}</CompleteMultipartUpload>`;
    const root = await this.requestMultipartXml({
      key: input.key,
      query: [["uploadId", input.uploadId]],
      body,
      contentType: "application/xml",
    });
    if (root.name !== "CompleteMultipartUploadResult") throw new R2XmlError();
    const fields = [
      "Location",
      "Bucket",
      "Key",
      "ETag",
      "ChecksumCRC32",
      "ChecksumCRC32C",
      "ChecksumCRC64NVME",
      "ChecksumSHA1",
      "ChecksumSHA256",
      "ChecksumType",
    ];
    xmlFields(root, fields);
    for (const field of fields) xmlField(root, field, false);
    if (xmlField(root, "Bucket") !== this.config.bucket || xmlField(root, "Key") !== input.key)
      throw new R2XmlError();
    const etag = boundedText(xmlField(root, "ETag"), 256);
    if (normalizeEtag(etag) !== etag) throw new R2XmlError();
    return { etag };
  }

  async abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void> {
    await this.signer.request({
      method: "DELETE",
      key: input.key,
      query: [["uploadId", input.uploadId]],
      signal: AbortSignal.timeout(LIST_DEADLINE_MS),
    });
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
    return this.readHeadObject(key, AbortSignal.timeout(LIST_DEADLINE_MS));
  }

  private async readHeadObject(key: string, signal: AbortSignal): Promise<StoredObjectMetadata> {
    signal.throwIfAborted();
    const response = await this.signer.request({ method: "HEAD", key, signal });
    if (signal.aborted) void response.body?.cancel().catch(() => undefined);
    signal.throwIfAborted();
    if (response.status !== 200) throw new R2UploadMetadataError();
    return objectMetadataFromHeaders(response.headers);
  }

  async observeUploadCompletion(
    input: UploadCompletionObservationInput,
  ): Promise<UploadCompletionObservation> {
    // One deadline covers all ListParts pages, their bodies and the final HEAD.
    // This never replays Complete, aborts, deletes or asserts write settlement.
    return this.observe("observeUploadCompletion", async (page, signal) => {
      boundedText(input.key, 1024);
      validateUploadCompletionExpectation(input);
      if (input.uploadId !== null) {
        multipartToken(input.uploadId, 1024);
        try {
          await this.readParts({ key: input.key, uploadId: input.uploadId }, page);
          return { status: "MULTIPART_PRESENT" };
        } catch (error) {
          if (
            !(error instanceof R2HttpError) ||
            error.status !== 404 ||
            error.providerCode !== "NoSuchUpload"
          )
            throw error;
        }
      }
      signal.throwIfAborted();
      try {
        const metadata = await this.readHeadObject(input.key, signal);
        return matchUploadCompletionObject(metadata, input.expected);
      } catch (error) {
        if (error instanceof R2HttpError && error.method === "HEAD" && error.status === 404)
          return { status: "OBJECT_ABSENT" };
        throw error;
      }
    });
  }

  async readObject(key: string, maxBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error("A positive bounded object-read limit is required.");
    }
    const metadata = await this.headObject(key);
    if (metadata.sizeBytes < 1 || metadata.sizeBytes > maxBytes) {
      throw new Error("R2 object exceeds the bounded read limit.");
    }
    const response = await this.signer.request({ method: "GET", key });
    const declaredLength = Number(response.headers.get("content-length") ?? metadata.sizeBytes);
    if (!Number.isFinite(declaredLength) || declaredLength < 1 || declaredLength > maxBytes) {
      await response.body?.cancel();
      throw new Error("R2 object exceeds the bounded read limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
      throw new Error("R2 object exceeds the bounded read limit.");
    }
    return bytes;
  }

  async deleteObject(key: string): Promise<void> {
    await this.signer.request({
      method: "DELETE",
      key,
      signal: AbortSignal.timeout(LIST_DEADLINE_MS),
    });
  }

  async deletePrefix(prefix: string): Promise<void> {
    // Bound the whole legacy prefix operation below one cleanup lease. An
    // expired lease must never be "solved" by accepting an unfenced DONE.
    await this.observe("deletePrefix", async (page, signal) => {
      boundedText(prefix, 1024);
      let continuationToken: string | null = null;
      let items = 0;
      const cursors = new Set<string>();
      for (let index = 0; index < MAX_LIST_PAGES; index++) {
        const query: Array<[string, string]> = [
          ["list-type", "2"],
          ["prefix", prefix],
          ["max-keys", "1000"],
          ["encoding-type", "url"],
        ];
        if (continuationToken) query.push(["continuation-token", continuationToken]);
        const root = await page({ query });
        if (root.name !== "ListBucketResult") throw new R2XmlError();
        xmlFields(root, [
          "Name",
          "Prefix",
          "KeyCount",
          "MaxKeys",
          "Delimiter",
          "IsTruncated",
          "Contents",
          "CommonPrefixes",
          "EncodingType",
          "ContinuationToken",
          "NextContinuationToken",
          "StartAfter",
        ]);
        if (
          xmlField(root, "EncodingType") !== "url" ||
          decodedKey(xmlField(root, "Prefix")) !== prefix ||
          xmlField(root, "Name") !== this.config.bucket
        )
          throw new R2XmlError();
        if (
          root.children.some((child) => child.name === "CommonPrefixes") ||
          xmlField(root, "Delimiter", false)
        )
          throw new R2XmlError();
        const rows = root.children.filter((child) => child.name === "Contents");
        if (
          integerField(root, "KeyCount", 0, LIST_PAGE_SIZE) !== rows.length ||
          integerField(root, "MaxKeys", 1, LIST_PAGE_SIZE) !== LIST_PAGE_SIZE
        )
          throw new R2XmlError();
        if (rows.length > LIST_PAGE_SIZE || items + rows.length > MAX_LIST_ITEMS)
          throw new R2XmlError(true);
        const keys = rows.map((row) => decodedKey(xmlField(row, "Key")));
        if (new Set(keys).size !== keys.length || keys.some((key) => !key.startsWith(prefix)))
          throw new R2XmlError();
        const more = truncated(root);
        const next = xmlField(root, "NextContinuationToken", false);
        if (more && (!rows.length || !next || cursors.has(next))) throw new R2XmlError();
        // Validate the complete page and cursor before any mutation from it.
        for (const key of keys) {
          signal.throwIfAborted();
          await this.signer.request({ method: "DELETE", key, signal });
        }
        items += keys.length;
        if (!more) return;
        continuationToken = boundedText(next, 4096);
        cursors.add(continuationToken);
      }
      throw new R2XmlError(true);
    });
  }

  async listMultipartUploads(prefix: string): Promise<AbandonedMultipartUpload[]> {
    return this.observe("listMultipartUploads", async (page) => {
      boundedText(prefix, 1024, true);
      const uploads: AbandonedMultipartUpload[] = [];
      const identities = new Set<string>();
      const cursors = new Set<string>([JSON.stringify(["", ""])]);
      let keyMarker = "",
        uploadMarker = "";
      for (let index = 0; index < MAX_LIST_PAGES; index++) {
        const query: Array<[string, string]> = [
          ["prefix", prefix],
          ["uploads", ""],
          ["max-uploads", String(LIST_PAGE_SIZE)],
          ["encoding-type", "url"],
        ];
        if (keyMarker) query.push(["key-marker", keyMarker], ["upload-id-marker", uploadMarker]);
        const root = await page({ query });
        if (root.name !== "ListMultipartUploadsResult") throw new R2XmlError();
        xmlFields(root, [
          "Bucket",
          "EncodingType",
          "Prefix",
          "KeyMarker",
          "UploadIdMarker",
          "NextKeyMarker",
          "NextUploadIdMarker",
          "MaxUploads",
          "IsTruncated",
          "Upload",
        ]);
        if (
          xmlField(root, "Bucket") !== this.config.bucket ||
          xmlField(root, "EncodingType") !== "url" ||
          decodedKey(xmlField(root, "Prefix"), true) !== prefix ||
          // R2 omits empty request-marker echoes on the first page. Later
          // pages must still echo both exact cursors; absence is not evidence.
          decodedKey(xmlField(root, "KeyMarker", keyMarker !== "") ?? "", true) !== keyMarker ||
          (xmlField(root, "UploadIdMarker", uploadMarker !== "") ?? "") !== uploadMarker
        )
          throw new R2XmlError();
        const limit = integerField(root, "MaxUploads", 1, LIST_PAGE_SIZE);
        const rows = root.children.filter((child) => child.name === "Upload");
        if (rows.length > limit) throw new R2XmlError();
        for (const row of rows) {
          xmlFields(row, [
            "Key",
            "UploadId",
            "Initiated",
            "Initiator",
            "Owner",
            "StorageClass",
            "ChecksumAlgorithm",
            "ChecksumType",
          ]);
          const key = decodedKey(xmlField(row, "Key"));
          const uploadId = boundedText(xmlField(row, "UploadId"), 1024);
          const identity = JSON.stringify([key, uploadId]);
          if (!key.startsWith(prefix) || identities.has(identity)) throw new R2XmlError();
          identities.add(identity);
          uploads.push({ key, uploadId, initiatedAt: initiatedDate(xmlField(row, "Initiated")) });
          if (uploads.length > MAX_LIST_ITEMS) throw new R2XmlError(true);
        }
        const more = truncated(root);
        const nextKey = xmlField(root, "NextKeyMarker", false);
        const nextUpload = xmlField(root, "NextUploadIdMarker", false);
        if (!more) return uploads;
        keyMarker = decodedKey(nextKey);
        uploadMarker = boundedText(nextUpload, 1024);
        const cursor = JSON.stringify([keyMarker, uploadMarker]);
        // Upload IDs are opaque. Do not infer ordering from their lexical form.
        if (!rows.length || !keyMarker.startsWith(prefix) || cursors.has(cursor))
          throw new R2XmlError();
        cursors.add(cursor);
        if (uploads.length >= MAX_LIST_ITEMS) throw new R2XmlError(true);
      }
      throw new R2XmlError(true);
    });
  }

  private async requestMultipartXml(input: {
    key: string;
    query: Array<[string, string]>;
    contentType: string;
    metadataHeaders?: Record<string, string>;
    body?: string;
  }): Promise<R2XmlNode> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("R2 multipart request timed out."));
      }, MULTIPART_DEADLINE_MS);
      timer.unref();
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const response = await this.signer.request({
            ...input,
            method: "POST",
            signal: controller.signal,
          });
          if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined);
          controller.signal.throwIfAborted();
          return parseR2Xml(
            await readR2XmlText(response, MULTIPART_RESPONSE_BYTES, controller.signal),
          );
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async observe<T>(
    operation: "listParts" | "listMultipartUploads" | "deletePrefix" | "observeUploadCompletion",
    work: (
      page: (input: { key?: string; query: Array<[string, string]> }) => Promise<R2XmlNode>,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remainingBytes = MAX_LIST_TOTAL_BYTES;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new MediaStorageObservationError("OBSERVATION_TIMEOUT", operation));
      }, LIST_DEADLINE_MS);
      timer.unref();
    });
    try {
      return await Promise.race([
        deadline,
        work(async (input) => {
          controller.signal.throwIfAborted();
          if (remainingBytes <= 0) throw new R2XmlError(true);
          const response = await this.signer.request({
            ...input,
            method: "GET",
            signal: controller.signal,
          });
          if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined);
          controller.signal.throwIfAborted();
          const xml = await readR2XmlText(
            response,
            Math.min(MAX_LIST_PAGE_BYTES, remainingBytes),
            controller.signal,
          );
          remainingBytes -= Buffer.byteLength(xml);
          return parseR2Xml(xml);
        }, controller.signal),
      ]);
    } catch (error) {
      if (error instanceof MediaStorageObservationError) throw error;
      let code: MediaStorageObservationCode = "PROVIDER_ERROR";
      if (controller.signal.aborted) code = "OBSERVATION_TIMEOUT";
      else if (error instanceof R2XmlError)
        code = error.limitExceeded ? "OBSERVATION_LIMIT_EXCEEDED" : "INVALID_RESPONSE";
      else if (error instanceof R2UploadMetadataError) code = "INVALID_RESPONSE";
      else if (
        error instanceof R2HttpError &&
        error.status === 404 &&
        error.providerCode === "NoSuchUpload" &&
        operation === "listParts"
      )
        code = "NO_SUCH_UPLOAD";
      throw new MediaStorageObservationError(
        code,
        operation,
        error instanceof R2HttpError ? error.status : undefined,
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
