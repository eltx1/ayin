import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { test, expect } from "@playwright/test";
import { R2MediaStorageAdapter } from "../../apps/api/src/media/r2-media-storage.adapter.js";
import type { MediaStorageConfig } from "../../apps/api/src/media/media-storage.config.js";

const ACCESS = "synthetic-browser-length-access";
const SECRET = "synthetic-browser-length-secret";
const MAX = 5 * 1024 * 1024;
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

// Independent incoming-wire reconstruction, not a call to the production signer.
function validSignature(request: IncomingMessage, url: URL) {
  const signature = url.searchParams.get("X-Amz-Signature") ?? "";
  const credential = url.searchParams.get("X-Amz-Credential")?.split("/");
  const names = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
  if (
    !/^[a-f0-9]{64}$/.test(signature) ||
    !credential ||
    credential.length !== 5 ||
    credential[0] !== ACCESS ||
    !["host", "content-length;host"].includes(names)
  )
    return false;
  const [, date, region, service, ending] = credential as [string, string, string, string, string];
  if (region !== "auto" || service !== "s3" || ending !== "aws4_request") return false;
  const query = [...url.searchParams]
    .filter(([key]) => key !== "X-Amz-Signature")
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(
      (a, b) =>
        Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])) ||
        Buffer.compare(Buffer.from(a[1]), Buffer.from(b[1])),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  let headers = "";
  for (const name of names.split(";")) {
    const raw = request.headers[name];
    if (typeof raw !== "string") return false;
    headers += `${name}:${raw.trim().replace(/\s+/g, " ")}\n`;
  }
  const canonical = ["PUT", url.pathname, query, headers, names, "UNSIGNED-PAYLOAD"].join("\n");
  const scope = credential.slice(1).join("/");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    url.searchParams.get("X-Amz-Date"),
    scope,
    sha(canonical),
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), region), service), ending);
  return timingSafeEqual(Buffer.from(signature, "hex"), hmac(signingKey, stringToSign));
}

let origin: string;
let endpoint: string;
let pageServer: Server;
let storageServer: Server;
let storage: R2MediaStorageAdapter;
const observed: Array<{
  length: string | undefined;
  bytes: number;
  signed: string | null;
  valid: boolean;
}> = [];
const preflights: string[] = [];
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing isolated test address");
  return `http://127.0.0.1:${address.port}`;
}
const close = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

test.beforeAll(async () => {
  pageServer = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><title>Isolated R2 length transport</title>");
  });
  origin = await listen(pageServer);
  storageServer = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-methods", "PUT");
    response.setHeader("access-control-expose-headers", "ETag");
    const requested = String(request.headers["access-control-request-headers"] ?? "");
    if (request.method === "OPTIONS") {
      preflights.push(requested);
      response.writeHead(204).end();
      return;
    }
    try {
      const url = new URL(request.url!, endpoint);
      if (request.method !== "PUT" || !url.pathname.startsWith("/ayin-test/fixture/")) {
        response.writeHead(404).end();
        return;
      }
      const valid = validSignature(request, url);
      let bytes = 0;
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX + 128) throw Error("Bound exceeded");
      }
      observed.push({
        length: request.headers["content-length"],
        bytes,
        signed: url.searchParams.get("X-Amz-SignedHeaders"),
        valid,
      });
      if (!valid) {
        response.writeHead(403).end("SignatureDoesNotMatch");
        return;
      }
      response.setHeader("etag", '"synthetic-part"');
      response.writeHead(200).end();
    } catch {
      response.writeHead(400).end("Invalid bounded fixture");
    }
  });
  endpoint = await listen(storageServer);
  const config: MediaStorageConfig = {
    mode: "r2",
    appEnv: "test",
    accountId: "synthetic",
    bucket: "ayin-test",
    accessKeyId: ACCESS,
    secretAccessKey: SECRET,
    endpoint,
    region: "auto",
    uploadUrlTtlSeconds: 60,
    partSizeBytes: MAX,
    multipartThresholdBytes: MAX,
    uploadSessionSecret: "synthetic-unused-session-secret-more-than32",
  };
  storage = new R2MediaStorageAdapter(config);
});
test.afterAll(async () => {
  await close(storageServer);
  await close(pageServer);
});
test.beforeEach(() => {
  observed.length = 0;
  preflights.length = 0;
});

for (const size of [38, 17, MAX])
  test(`Chromium automatically supplies signed Content-Length for a ${size}-byte Blob`, async ({
    page,
  }) => {
    const grant = await storage.authorizeMultipartPart({
      key: "fixture/source.bin",
      uploadId: "synthetic-upload",
      partNumber: 1,
      expectedSizeBytes: size,
      expiresInSeconds: 60,
    });
    await page.goto(origin);
    const result = await page.evaluate(
      async ({ url, size }) => {
        const body = new Blob([new Uint8Array(size).fill(29)]);
        // Never set the forbidden Content-Length header. The browser owns it.
        const response = await fetch(url, {
          method: "PUT",
          body,
          credentials: "omit",
          redirect: "error",
        });
        return { status: response.status, etag: response.headers.get("etag") };
      },
      { url: grant.url, size },
    );
    expect(result).toEqual({ status: 200, etag: '"synthetic-part"' });
    expect(observed).toEqual([
      { length: String(size), bytes: size, signed: "content-length;host", valid: true },
    ]);
    expect(preflights.length).toBe(1);
    expect(preflights[0]).not.toContain("content-length");
  });

for (const actualSize of [37, 39])
  test(`a ${actualSize}-byte Blob fails verification against signed 38-byte length`, async ({
    page,
  }) => {
    const grant = await storage.authorizeMultipartPart({
      key: "fixture/source.bin",
      uploadId: "synthetic-upload",
      partNumber: 1,
      expectedSizeBytes: 38,
      expiresInSeconds: 60,
    });
    await page.goto(origin);
    const status = await page.evaluate(
      async ({ url, actualSize }) =>
        (
          await fetch(url, {
            method: "PUT",
            body: new Blob([new Uint8Array(actualSize)]),
            credentials: "omit",
            redirect: "error",
          })
        ).status,
      { url: grant.url, actualSize },
    );
    expect(status).toBe(403);
    expect(observed).toEqual([
      {
        length: String(actualSize),
        bytes: actualSize,
        signed: "content-length;host",
        valid: false,
      },
    ]);
  });

test("legacy part grants preserve host-only signatures", async ({ page }) => {
  const grant = await storage.authorizeMultipartPart({
    key: "fixture/legacy.bin",
    uploadId: "synthetic-upload",
    partNumber: 1,
    expiresInSeconds: 60,
  });
  await page.goto(origin);
  const status = await page.evaluate(
    async (url) =>
      (
        await fetch(url, {
          method: "PUT",
          body: new Blob([new Uint8Array(38)]),
          credentials: "omit",
          redirect: "error",
        })
      ).status,
    grant.url,
  );
  expect(status).toBe(200);
  expect(observed).toEqual([{ length: "38", bytes: 38, signed: "host", valid: true }]);
});
