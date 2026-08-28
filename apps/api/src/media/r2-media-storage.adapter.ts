import type { MediaStorageConfig } from "./media-storage.config.js";
import type {
  AbandonedMultipartUpload,
  CompletedUploadPart,
  ExistingUploadPart,
  MediaStorageAdapter,
  StoredObjectMetadata,
} from "./media-storage.adapter.js";
import { R2SigV4 } from "./r2-sigv4.js";

function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match?.[1]?.trim() ?? null;
}

function normalizeEtag(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') ? trimmed : `"${trimmed.replaceAll('"', "")}"`;
}

export class R2MediaStorageAdapter implements MediaStorageAdapter {
  readonly kind = "r2" as const;
  readonly available = true;
  private readonly signer: R2SigV4;

  constructor(config: MediaStorageConfig) {
    this.signer = new R2SigV4(config);
  }

  async createMultipartUpload(input: {
    key: string;
    contentType: string;
  }): Promise<{ uploadId: string }> {
    const response = await this.signer.request({
      method: "POST",
      key: input.key,
      query: [["uploads", ""]],
      contentType: input.contentType,
    });
    const xml = await response.text();
    const uploadId = xmlValue(xml, "UploadId");
    if (!uploadId) {
      throw new Error("R2 did not return a multipart upload identifier.");
    }
    return { uploadId };
  }

  async authorizeMultipartPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return this.signer.presign({
      method: "PUT",
      key: input.key,
      query: [
        ["partNumber", String(input.partNumber)],
        ["uploadId", input.uploadId],
      ],
      expiresInSeconds: input.expiresInSeconds,
    });
  }

  async authorizeSinglePut(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return this.signer.presign({
      method: "PUT",
      key: input.key,
      contentType: input.contentType,
      expiresInSeconds: input.expiresInSeconds,
    });
  }

  async listParts(input: { key: string; uploadId: string }): Promise<ExistingUploadPart[]> {
    const response = await this.signer.request({
      method: "GET",
      key: input.key,
      query: [["uploadId", input.uploadId]],
    });
    const xml = await response.text();
    const parts: ExistingUploadPart[] = [];
    for (const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
      const block = match[1] ?? "";
      const partNumber = Number(xmlValue(block, "PartNumber"));
      const etag = xmlValue(block, "ETag");
      const sizeBytes = Number(xmlValue(block, "Size"));
      if (Number.isInteger(partNumber) && partNumber > 0 && etag && Number.isFinite(sizeBytes)) {
        parts.push({ partNumber, etag, sizeBytes });
      }
    }
    return parts.sort((left, right) => left.partNumber - right.partNumber);
  }

  async completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: CompletedUploadPart[];
  }): Promise<{ etag: string | null }> {
    const body = `<CompleteMultipartUpload>${input.parts
      .sort((left, right) => left.partNumber - right.partNumber)
      .map(
        (part) =>
          `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${normalizeEtag(part.etag)}</ETag></Part>`,
      )
      .join("")}</CompleteMultipartUpload>`;
    const response = await this.signer.request({
      method: "POST",
      key: input.key,
      query: [["uploadId", input.uploadId]],
      body,
      contentType: "application/xml",
    });
    const xml = await response.text();
    return { etag: xmlValue(xml, "ETag") };
  }

  async abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void> {
    await this.signer.request({
      method: "DELETE",
      key: input.key,
      query: [["uploadId", input.uploadId]],
    });
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
    const response = await this.signer.request({ method: "HEAD", key });
    return {
      sizeBytes: Number(response.headers.get("content-length") ?? "0"),
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.signer.request({ method: "DELETE", key });
  }

  async listMultipartUploads(prefix: string): Promise<AbandonedMultipartUpload[]> {
    const response = await this.signer.request({
      method: "GET",
      query: [
        ["prefix", prefix],
        ["uploads", ""],
      ],
    });
    const xml = await response.text();
    const uploads: AbandonedMultipartUpload[] = [];
    for (const match of xml.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)) {
      const block = match[1] ?? "";
      const key = xmlValue(block, "Key");
      const uploadId = xmlValue(block, "UploadId");
      const initiated = xmlValue(block, "Initiated");
      if (key && uploadId && initiated) {
        uploads.push({ key, uploadId, initiatedAt: new Date(initiated) });
      }
    }
    return uploads;
  }
}
