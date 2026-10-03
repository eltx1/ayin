import { apiBaseUrl } from "./api";
import type { DirectUploadResult, UploadSession } from "./direct-video-upload";

export class UploadProtocolError extends Error {
  constructor() {
    super(
      "The upload response could not be verified. Review this upload in Studio before trying again.",
    );
    this.name = "UploadProtocolError";
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UploadProtocolError();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n]/.test(value))
    throw new UploadProtocolError();
  return value;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max)
    throw new UploadProtocolError();
  return value;
}
function assetId(value: unknown): string {
  const id = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new UploadProtocolError();
  return id;
}
export function validateUploadUrl(value: unknown): string {
  const raw = text(value, 16384);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UploadProtocolError();
  }
  const api = new URL(apiBaseUrl);
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.origin === api.origin;
  if ((url.protocol !== "https:" && !local) || url.username || url.password || url.hash)
    throw new UploadProtocolError();
  return raw;
}
export function parseUploadSession(value: unknown, sizeBytes: number): UploadSession {
  const row = record(value);
  integer(sizeBytes);
  const base = { assetId: assetId(row.assetId), sessionToken: text(row.sessionToken, 8192) };
  if (row.mode === "multipart") {
    const partSizeBytes = integer(row.partSizeBytes),
      partCount = integer(row.partCount, 10000);
    if (partCount !== Math.ceil(sizeBytes / partSizeBytes)) throw new UploadProtocolError();
    return { ...base, mode: "multipart", partSizeBytes, partCount };
  }
  if (row.mode !== "single") throw new UploadProtocolError();
  const upload = record(row.upload),
    headers = record(upload.headers);
  if (upload.method !== "PUT" || Object.keys(headers).length > 30) throw new UploadProtocolError();
  const selected: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[a-z0-9-]{1,100}$/i.test(key)) throw new UploadProtocolError();
    selected[key] = text(value, 8192);
  }
  return {
    ...base,
    mode: "single",
    upload: { url: validateUploadUrl(upload.url), method: "PUT", headers: selected },
  };
}
export function parseResumedParts(
  value: unknown,
  session: Extract<UploadSession, { mode: "multipart" }>,
  sizeBytes: number,
) {
  const row = record(value);
  if (!Array.isArray(row.parts) || row.parts.length > session.partCount)
    throw new UploadProtocolError();
  const seen = new Set<number>();
  return row.parts.map((value: unknown) => {
    const part = record(value),
      partNumber = integer(part.partNumber, session.partCount);
    const bytes = integer(part.sizeBytes);
    if (
      seen.has(partNumber) ||
      bytes !==
        Math.min(session.partSizeBytes, sizeBytes - (partNumber - 1) * session.partSizeBytes)
    )
      throw new UploadProtocolError();
    seen.add(partNumber);
    return { partNumber, etag: text(part.etag, 512), sizeBytes: bytes };
  });
}
export function parseUploadCompletion(value: unknown, expectedAssetId: string): DirectUploadResult {
  const row = record(value),
    id = assetId(row.assetId);
  if (id !== expectedAssetId || row.status !== "UPLOADED") throw new UploadProtocolError();
  return { assetId: id, status: "UPLOADED" };
}

export function parseUploadPartUrl(value: unknown): string {
  return validateUploadUrl(record(value).url);
}
