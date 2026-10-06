// Isolated test-only HTTP byte store. Never loaded by the production API.
import "../../apps/api/node_modules/reflect-metadata/Reflect.js";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { AppModule } from "../../apps/api/dist/app.module.js";
import { E2eMediaStorageAdapter } from "../../apps/api/dist/media/e2e-media-storage.adapter.js";
import { MEDIA_STORAGE_ADAPTER } from "../../apps/api/dist/media/media-storage.adapter.js";
import {
  applyApiSecurityHeaders,
  isAllowedCookieMutationOrigin,
} from "../../apps/api/dist/security/request-security.js";
const requireApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { Test } = await import(requireApi.resolve("@nestjs/testing"));
const { FastifyAdapter } = await import(requireApi.resolve("@nestjs/platform-fastify"));
const db = new URL(process.env.DATABASE_URL ?? "https://invalid.test");
if (process.env.APP_ENV !== "test" || db.hostname !== "127.0.0.1" || db.pathname !== "/ayin_e2e")
  throw new Error("Caption browser server requires isolated local test database");
const origin = "http://127.0.0.1:3000",
  provider = "http://127.0.0.1:3002";
const grants = new Map(),
  objects = new Map(),
  counts = { put: 0, head: 0, read: 0, delete: 0 };
const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "PUT, GET, HEAD, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url, provider);
  if (url.pathname === "/stats" && req.method === "GET") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(counts));
    return;
  }
  const grant = grants.get(url.searchParams.get("grant"));
  if (!grant || grant.expires < Date.now()) {
    res.writeHead(403).end();
    return;
  }
  if (req.method === "PUT") {
    const parts = [];
    let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > 2 * 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
      parts.push(part);
    }
    objects.set(grant.key, { bytes: Buffer.concat(parts), mime: req.headers["content-type"] });
    counts.put++;
    res.writeHead(200).end();
    return;
  }
  const object = objects.get(grant.key);
  if (!object) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("content-type", object.mime);
  res.setHeader("content-length", object.bytes.length);
  res.setHeader("etag", '"local-caption-bytes"');
  if (req.method === "HEAD") {
    counts.head++;
    res.end();
  } else if (req.method === "GET") {
    counts.read++;
    res.end(object.bytes);
  } else res.writeHead(405).end();
});
await new Promise((resolve) => server.listen(3002, "127.0.0.1", resolve));
class BrowserStorage extends E2eMediaStorageAdapter {
  urls = new Map();
  async authorizeSinglePut(input) {
    if (!input.key.startsWith("captions/videos/")) return super.authorizeSinglePut(input);
    const grant = randomUUID(),
      expiresAt = new Date(Date.now() + 900_000),
      url = `${provider}/object?grant=${grant}`;
    grants.set(grant, { key: input.key, expires: expiresAt.getTime() });
    this.urls.set(input.key, url);
    return { url, expiresAt };
  }
  async headObject(key) {
    if (!key.startsWith("captions/videos/")) return super.headObject(key);
    const response = await fetch(this.urls.get(key) ?? `${provider}/missing`, { method: "HEAD" });
    if (!response.ok) throw new Error("Local provider object missing");
    return {
      sizeBytes: Number(response.headers.get("content-length")),
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
    };
  }
  async readObject(key, maxBytes) {
    const response = await fetch(this.urls.get(key) ?? `${provider}/missing`);
    if (!response.ok) throw new Error("Local provider read unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("Local provider size bound exceeded");
    return bytes;
  }
  async deleteObject(key) {
    objects.delete(key);
    counts.delete++;
  }
}
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(MEDIA_STORAGE_ADAPTER)
  .useValue(new BrowserStorage())
  .compile();
const app = module.createNestApplication(
  new FastifyAdapter({ trustProxy: "127.0.0.1", bodyLimit: 1024 * 1024 }),
);
app.enableCors({
  origin,
  credentials: true,
  allowedHeaders: [
    "authorization",
    "content-type",
    "x-ayin-auth-transport",
    "x-ayin-expected-account",
  ],
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
app
  .getHttpAdapter()
  .getInstance()
  .addHook("onRequest", async (request, reply) => {
    applyApiSecurityHeaders(reply, request);
    if (!isAllowedCookieMutationOrigin(request, origin))
      await reply.code(403).send({ error: { code: "CSRF_ORIGIN_REJECTED" } });
  });
await app.listen({ host: "127.0.0.1", port: 3001 });
console.log("CAPTION_LOCAL_PROVIDER_READY");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    server.close();
    process.exit(0);
  });
