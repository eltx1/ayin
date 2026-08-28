import { createHash, createHmac } from "node:crypto";

import type { MediaStorageConfig } from "./media-storage.config.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalQuery(parameters: Array<[string, string]>): string {
  return parameters
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalPath(bucket: string, key?: string): string {
  const suffix = key
    ? `/${key
        .split("/")
        .map((segment) => encodeRfc3986(segment))
        .join("/")}`
    : "";
  return `/${encodeRfc3986(bucket)}${suffix}`;
}

export class R2SigV4 {
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly region: string;

  constructor(config: MediaStorageConfig) {
    if (
      !config.endpoint ||
      !config.bucket ||
      !config.accessKeyId ||
      !config.secretAccessKey ||
      config.mode !== "r2"
    ) {
      throw new Error("R2SigV4 requires complete R2 configuration.");
    }
    this.endpoint = new URL(config.endpoint);
    this.bucket = config.bucket;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.region = config.region;
  }

  presign(input: {
    method: "PUT";
    key: string;
    query?: Array<[string, string]>;
    expiresInSeconds: number;
    contentType?: string;
    now?: Date;
  }): { url: string; expiresAt: Date } {
    const now = input.now ?? new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const signedHeaders = input.contentType ? "content-type;host" : "host";
    const headers = input.contentType
      ? `content-type:${input.contentType}\nhost:${this.endpoint.host}\n`
      : `host:${this.endpoint.host}\n`;
    const parameters: Array<[string, string]> = [
      ...(input.query ?? []),
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.accessKeyId}/${scope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(input.expiresInSeconds)],
      ["X-Amz-SignedHeaders", signedHeaders],
    ];
    const query = canonicalQuery(parameters);
    const canonicalRequest = [
      input.method,
      canonicalPath(this.bucket, input.key),
      query,
      headers,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join("\n");
    const signature = this.signature(dateStamp, stringToSign);
    const url = new URL(canonicalPath(this.bucket, input.key), this.endpoint);
    url.search = `${query}&X-Amz-Signature=${signature}`;
    return {
      url: url.toString(),
      expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000),
    };
  }

  async request(input: {
    method: "GET" | "POST" | "DELETE" | "HEAD";
    key?: string;
    query?: Array<[string, string]>;
    body?: string;
    contentType?: string;
  }): Promise<Response> {
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const body = input.body ?? "";
    const payloadHash = sha256(body);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const signedHeaderNames = input.contentType
      ? "content-type;host;x-amz-content-sha256;x-amz-date"
      : "host;x-amz-content-sha256;x-amz-date";
    const canonicalHeaders = input.contentType
      ? `content-type:${input.contentType}\nhost:${this.endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
      : `host:${this.endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const query = canonicalQuery(input.query ?? []);
    const canonicalRequest = [
      input.method,
      canonicalPath(this.bucket, input.key),
      query,
      canonicalHeaders,
      signedHeaderNames,
      payloadHash,
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join("\n");
    const signature = this.signature(dateStamp, stringToSign);
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaderNames}, Signature=${signature}`;
    const url = new URL(canonicalPath(this.bucket, input.key), this.endpoint);
    if (query) {
      url.search = query;
    }
    const headers: Record<string, string> = {
      authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (input.contentType) {
      headers["content-type"] = input.contentType;
    }
    const response = await fetch(url, {
      method: input.method,
      headers,
      body: input.method === "POST" ? body : undefined,
    });
    if (!response.ok) {
      const detail = input.method === "HEAD" ? "" : await response.text();
      throw new Error(`R2 ${input.method} request failed (${response.status}). ${detail}`.trim());
    }
    return response;
  }

  private signature(dateStamp: string, stringToSign: string): string {
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    return createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  }
}
