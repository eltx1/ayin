import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// A disposable, bounded HTTP provider fixture. It deliberately does not import
// the production signer: incoming requests are verified from their wire bytes.
// This is not Cloudflare R2 and must never be reported as provider acceptance.
const ACCESS = "connected-media-fixture-access";
const SECRET = "connected-media-fixture-secret-not-a-provider-credential";
const BUCKET = "ayin-connected-test";
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const MAX_OPERATIONS = 200;
const MAX_OBJECTS = 16;

interface StoredObject {
  bytes: Buffer;
  contentType: string;
  etag: string;
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function verifiedSignature(request: IncomingMessage, url: URL): boolean {
  const querySigned = url.searchParams.has("X-Amz-Signature");
  const authorization = request.headers.authorization ?? "";
  const headerMatch =
    /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(
      authorization,
    );
  const credential = querySigned ? url.searchParams.get("X-Amz-Credential") : headerMatch?.[1];
  const names = querySigned ? url.searchParams.get("X-Amz-SignedHeaders") : headerMatch?.[2];
  const signature = querySigned ? url.searchParams.get("X-Amz-Signature") : headerMatch?.[3];
  const timestamp = querySigned
    ? url.searchParams.get("X-Amz-Date")
    : request.headers["x-amz-date"];
  if (
    !credential ||
    !names ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    typeof timestamp !== "string" ||
    !/^\d{8}T\d{6}Z$/.test(timestamp)
  )
    return false;
  const scope = credential.split("/");
  if (
    scope.length !== 5 ||
    scope[0] !== ACCESS ||
    scope[1] !== timestamp.slice(0, 8) ||
    scope[2] !== "auto" ||
    scope[3] !== "s3" ||
    scope[4] !== "aws4_request"
  )
    return false;
  const signedNames = names.split(";");
  if (!signedNames.includes("host") || signedNames.join(";") !== [...signedNames].sort().join(";"))
    return false;
  if (querySigned && (request.method !== "PUT" || !signedNames.includes("content-type")))
    return false;
  if (!querySigned && !["GET", "HEAD", "DELETE"].includes(request.method ?? "")) return false;
  const signedAt = Date.parse(
    timestamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"),
  );
  const lifetime = querySigned ? Number(url.searchParams.get("X-Amz-Expires")) : 60;
  if (
    !Number.isSafeInteger(lifetime) ||
    lifetime < 1 ||
    lifetime > 3600 ||
    Date.now() < signedAt - 5_000 ||
    Date.now() >= signedAt + lifetime * 1000
  )
    return false;
  let headers = "";
  for (const name of signedNames) {
    const value = request.headers[name];
    if (typeof value !== "string") return false;
    headers += `${name}:${value.trim().replace(/\s+/g, " ")}\n`;
  }
  const query = [...url.searchParams]
    .filter(([key]) => key !== "X-Amz-Signature")
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(
      (left, right) =>
        Buffer.compare(Buffer.from(left[0]), Buffer.from(right[0])) ||
        Buffer.compare(Buffer.from(left[1]), Buffer.from(right[1])),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const payloadHash = querySigned ? "UNSIGNED-PAYLOAD" : request.headers["x-amz-content-sha256"];
  if (!querySigned && payloadHash !== digest("")) return false;
  const canonical = [request.method, url.pathname, query, headers, names, payloadHash].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", timestamp, scope.slice(1).join("/"), digest(canonical)].join(
    "\n",
  );
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${SECRET}`, scope[1]!), "auto"), "s3"),
    "aws4_request",
  );
  return timingSafeEqual(Buffer.from(signature, "hex"), hmac(signingKey, toSign));
}

export class ConnectedMediaObjectStore {
  readonly objects = new Map<string, StoredObject>();
  readonly allowedChannels = new Set<string>();
  readonly operations: Array<{ method: string; key: string; bytes: number; status: number }> = [];
  private endpoint = "";
  private retainedBytes = 0;
  private requests = 0;
  private readonly server = createServer((request, response) => {
    void this.handle(request, response).catch(() => {
      // Never print a request URL: it can contain a signed capability.
      if (!response.headersSent) response.writeHead(400);
      response.end("Bounded fixture rejected the request.");
    });
  });

  async start() {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind loopback.");
    this.endpoint = `http://127.0.0.1:${address.port}`;
    return {
      endpoint: this.endpoint,
      bucket: BUCKET,
      accessKeyId: ACCESS,
      secretAccessKey: SECRET,
    };
  }

  publicUrl(key: string) {
    return `${this.endpoint}/public/${key.split("/").map(encode).join("/")}`;
  }

  async close() {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
    this.objects.clear();
    this.allowedChannels.clear();
    this.retainedBytes = 0;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    if (++this.requests > MAX_OPERATIONS) throw new Error("Fixture request budget exceeded.");
    const url = new URL(request.url ?? "", this.endpoint);
    const publicRead = url.pathname.startsWith("/public/");
    const prefix = publicRead ? "/public/" : `/${BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return void response.writeHead(404).end();
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    const channelId = /^channels\/([0-9a-f-]{36})\//.exec(key)?.[1];
    if (!channelId || !this.allowedChannels.has(channelId) || key.includes(".."))
      return void response.writeHead(404).end();
    if (
      publicRead
        ? !["GET", "HEAD"].includes(request.method ?? "")
        : !verifiedSignature(request, url)
    ) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === "PUT") {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_OBJECT_BYTES) throw new Error("Fixture object limit exceeded.");
        chunks.push(bytes);
      }
      const previous = this.objects.get(key)?.bytes.length ?? 0;
      if (
        (!this.objects.has(key) && this.objects.size >= MAX_OBJECTS) ||
        this.retainedBytes - previous + size > MAX_RETAINED_BYTES
      )
        throw new Error("Fixture retained-byte budget exceeded.");
      const bytes = Buffer.concat(chunks);
      const etag = `"${digest(bytes)}"`;
      this.objects.set(key, { bytes, contentType: String(request.headers["content-type"]), etag });
      this.retainedBytes += size - previous;
      this.operations.push({ method: "PUT", key, bytes: size, status: 200 });
      response.writeHead(200, { etag }).end();
      return;
    }
    if (request.method === "DELETE") {
      this.retainedBytes -= this.objects.get(key)?.bytes.length ?? 0;
      this.objects.delete(key);
      this.operations.push({ method: "DELETE", key, bytes: 0, status: 204 });
      response.writeHead(204).end();
      return;
    }
    const object = this.objects.get(key);
    if (!object) return void response.writeHead(404).end();
    const headers = {
      "content-type": object.contentType,
      etag: object.etag,
      "accept-ranges": "bytes",
    };
    if (request.method === "GET" && request.headers.range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range);
      const start = Number(match?.[1]);
      const end = Number(match?.[2]);
      if (!match || start > end || end >= object.bytes.length)
        return void response.writeHead(416).end();
      const bytes = object.bytes.subarray(start, end + 1);
      this.operations.push({ method: "RANGE", key, bytes: bytes.length, status: 206 });
      response
        .writeHead(206, {
          ...headers,
          "content-length": bytes.length,
          "content-range": `bytes ${start}-${end}/${object.bytes.length}`,
        })
        .end(bytes);
      return;
    }
    this.operations.push({
      method: request.method ?? "",
      key,
      bytes: request.method === "HEAD" ? 0 : object.bytes.length,
      status: 200,
    });
    response.writeHead(200, { ...headers, "content-length": object.bytes.length });
    response.end(request.method === "HEAD" ? undefined : object.bytes);
  }
}
