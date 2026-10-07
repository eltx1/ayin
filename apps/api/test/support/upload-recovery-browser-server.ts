/** Isolated synthetic provider for browser acceptance only. Never imported by AppModule. */
import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import {
  DURABLE_UPLOAD_SETTLEMENT,
  type DurableUploadSettlementEvidence,
} from "../../src/media/durable-upload-settlement.js";
import { MediaProcessingStorageService } from "../../src/media/media-processing-storage.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type MediaStorageAdapter,
} from "../../src/media/media-storage.adapter.js";
import { loadMediaStorageConfig } from "../../src/media/media-storage.config.js";
import {
  applyApiSecurityHeaders,
  isAllowedCookieMutationOrigin,
} from "../../src/security/request-security.js";

const databaseUrl = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
if (
  process.env.APP_ENV !== "test" ||
  !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== "/ayin_e2e"
)
  throw Error("Synthetic browser provider requires isolated local ayin_e2e and APP_ENV=test.");
process.env.DATABASE_URL = databaseUrl.href;
const db = createPrismaClient(databaseUrl.href);
const PART = 5 * 1024 * 1024;
// Optional local transport measurement only. Reuses this exact synthetic store;
// never imported by AppModule or enabled by production API bootstrap.
const directTransfer = process.env.AYIN_LAB_DIRECT_TRANSFER === "1";
const directPrefix = "/_test/recovery-byte-store/";
const received: Array<{
  bytes: number;
  sha256: string;
  bodyReceiveMs: number;
  cookiePresent: boolean;
  authorizationPresent: boolean;
}> = [];
const requestStarts = new WeakMap<object, number>();
let supported = true,
  failAuthorize = false;
let counters = { allocations: 0, authorizations: 0, puts: 0, completes: 0 };
const uploads = new Map<string, { key: string; contentType: string; parts: Map<number, Buffer> }>();
const objects = new Map<string, { contentType: string; bytes: Buffer }>();
const grants = new Map<
  string,
  {
    key: string;
    contentType: string;
    uploadId?: string;
    partNumber?: number;
    expiresAt: Date;
    used: boolean;
  }
>();
function evidence(): DurableUploadSettlementEvidence | null {
  return supported
    ? {
        provider: "r2",
        version: "AYIN_DURABLE_UPLOAD_ADMISSION_V1",
        browserGrantSettlement: {
          conclusion: "NO_LATE_PUT_PART_COMPLETE_OR_ALLOCATION",
          proofReference: "synthetic:browser-test-only",
        },
        serverWriteSettlement: {
          conclusion: "NO_LATE_SOURCE_OR_OUTPUT_WRITE",
          proofReference: "synthetic:browser-test-only",
        },
        verifiedAt: new Date(Date.now() - 1000),
        validUntil: new Date(Date.now() + 3600_000),
      }
    : null;
}
function authorize(input: {
  key: string;
  contentType: string;
  uploadId?: string;
  partNumber?: number;
  expiresInSeconds: number;
  now?: Date;
}) {
  counters.authorizations++;
  if (failAuthorize) {
    failAuthorize = false;
    throw Error("Synthetic uncertain signing dispatch");
  }
  const token = randomUUID(),
    expiresAt = new Date((input.now ?? new Date()).getTime() + input.expiresInSeconds * 1000);
  grants.set(token, { ...input, expiresAt, used: false });
  return {
    url: directTransfer
      ? `http://127.0.0.1:3001${directPrefix}${token}`
      : `https://recovery-provider.invalid/${token}`,
    expiresAt,
  };
}
function storeGrantedBytes(token: string, body: Buffer) {
  const grant = grants.get(token);
  if (!grant || grant.used || grant.expiresAt.getTime() <= Date.now())
    throw Error("Synthetic grant expired/reused");
  grant.used = true;
  counters.puts++;
  if (grant.uploadId) {
    const upload = uploads.get(grant.uploadId);
    if (!upload || !grant.partNumber) throw Error("Unknown synthetic upload");
    upload.parts.set(grant.partNumber, body);
  } else objects.set(grant.key, { bytes: body, contentType: grant.contentType });
}
const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  verifyUploadCleanupSettlement: async () => null,
  createMultipartUpload: async ({ key, contentType }) => {
    counters.allocations++;
    const uploadId = randomUUID();
    uploads.set(uploadId, { key, contentType, parts: new Map() });
    return { uploadId };
  },
  authorizeSinglePut: async (input) => authorize(input),
  authorizeMultipartPart: async (input) => {
    const upload = uploads.get(input.uploadId);
    if (!upload || upload.key !== input.key) throw Error("Unknown synthetic upload");
    return authorize({ ...input, contentType: upload.contentType });
  },
  listParts: async ({ key, uploadId }) => {
    const upload = uploads.get(uploadId);
    if (!upload || upload.key !== key) throw Error("Unknown synthetic upload");
    return [...upload.parts]
      .map(([partNumber, bytes]) => ({
        partNumber,
        sizeBytes: bytes.length,
        etag: `"synthetic-${partNumber}"`,
      }))
      .sort((a, b) => a.partNumber - b.partNumber);
  },
  completeMultipartUpload: async ({ key, uploadId, parts }) => {
    counters.completes++;
    const upload = uploads.get(uploadId);
    if (!upload || upload.key !== key) throw Error("Unknown synthetic upload");
    const bytes = parts.map((part) => {
      const bytes = upload.parts.get(part.partNumber);
      if (!bytes || part.etag !== `"synthetic-${part.partNumber}"`)
        throw Error("Bad synthetic part");
      return bytes;
    });
    objects.set(key, { bytes: Buffer.concat(bytes), contentType: upload.contentType });
    uploads.delete(uploadId);
    return { etag: '"synthetic-complete"' };
  },
  abortMultipartUpload: async ({ uploadId }) => {
    uploads.delete(uploadId);
  },
  headObject: async (key) => {
    const object = objects.get(key);
    if (!object) throw Error("Synthetic object absent");
    return {
      sizeBytes: object.bytes.length,
      contentType: object.contentType,
      etag: '"synthetic-object"',
    };
  },
  deleteObject: async (key) => {
    objects.delete(key);
  },
  deletePrefix: async () => undefined,
  listMultipartUploads: async () => [],
};
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(MEDIA_STORAGE_ADAPTER)
  .useValue(storage)
  .overrideProvider(MEDIA_STORAGE_CONFIG)
  .useValue({
    ...loadMediaStorageConfig({ APP_ENV: "test" }),
    multipartThresholdBytes: PART,
    partSizeBytes: PART,
  })
  .overrideProvider(MediaProcessingStorageService)
  .useValue({ headObject: storage.headObject })
  .overrideProvider(DURABLE_UPLOAD_SETTLEMENT)
  .useValue({ admissionEvidence: evidence })
  .compile();
const app = module.createNestApplication<NestFastifyApplication>(
  new FastifyAdapter({ bodyLimit: 1024 * 1024 }),
  { logger: false },
);
app.enableCors({
  origin: "http://127.0.0.1:3000",
  credentials: true,
  allowedHeaders: ["content-type", "x-ayin-expected-account", "x-ayin-expected-session"],
  methods: ["GET", "POST", "OPTIONS", ...(directTransfer ? ["PUT"] : [])],
});
app
  .getHttpAdapter()
  .getInstance()
  .addHook("onRequest", async (request, reply) => {
    if (directTransfer && request.url.startsWith(directPrefix))
      requestStarts.set(request, performance.now());
    applyApiSecurityHeaders(reply, request);
    if (!isAllowedCookieMutationOrigin(request, "http://127.0.0.1:3000"))
      await reply.code(403).send({ error: { code: "CSRF_ORIGIN_REJECTED" } });
  });
if (directTransfer) {
  const server = app.getHttpAdapter().getInstance();
  server.addContentTypeParser(
    ["video/webm", "video/mp4", "application/octet-stream"],
    { parseAs: "buffer", bodyLimit: PART + 1024 },
    (_request, body, done) => done(null, body),
  );
  server.put(directPrefix + ":token", { bodyLimit: PART + 1024 }, async (request, reply) => {
    try {
      if (!Buffer.isBuffer(request.body)) throw Error("Synthetic byte body required");
      const token = (request.params as { token: string }).token;
      const startedAt = requestStarts.get(request);
      if (startedAt === undefined) throw Error("Missing synthetic receiver timing start");
      const bodyReceiveMs = performance.now() - startedAt;
      storeGrantedBytes(token, request.body);
      received.push({
        bytes: request.body.length,
        sha256: createHash("sha256").update(request.body).digest("hex"),
        bodyReceiveMs,
        cookiePresent: Boolean(request.headers.cookie),
        authorizationPresent: Boolean(request.headers.authorization),
      });
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: "Synthetic provider rejection" });
    }
  });
}
await app.listen(3001, "127.0.0.1");
// A separate provider test server receives synthetic fixture bytes. The AYIN API
// never accepts/proxies creator bodies in production. The guarded direct lab
// uses the same maps through the optional test-only API-origin route above.
const provider = createServer(async (request, reply) => {
  reply.setHeader("content-type", "application/json");
  try {
    if (request.method === "GET" && request.url === "/stats") {
      reply.end(
        JSON.stringify({
          ...counters,
          ...(directTransfer
            ? {
                received,
                storedObjects: [...objects.values()].map(({ bytes, contentType }) => ({
                  bytes: bytes.length,
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                  contentType,
                })),
                uploadedSources: await db.mediaAsset.count({
                  where: { kind: "SOURCE_VIDEO", status: "UPLOADED" },
                }),
                processingQueued: await db.mediaProcessingJob.count({
                  where: { status: "QUEUED", stage: "QUEUED" },
                }),
                validatingVideos: await db.video.count({ where: { status: "VALIDATING" } }),
              }
            : {}),
          sessions: await db.mediaUploadSession.count(),
          journal: await db.mediaUploadOperation.count(),
          queued: await db.mediaProcessingJob.count({ where: { stage: "INTEGRITY_QUEUED" } }),
          cleanup: await db.privacyMediaDeletionJob.count(),
          published: await db.video.count({ where: { status: "PUBLISHED" } }),
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const raw of request) {
      const chunk = Buffer.from(raw as Uint8Array);
      total += chunk.length;
      if (total > PART + 1024) throw Error("Synthetic body limit");
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    if (request.method === "POST" && request.url === "/control") {
      const input = JSON.parse(body.toString()) as {
        reset?: boolean;
        supported?: boolean;
        failAuthorize?: boolean;
      };
      if (input.reset) {
        await db.$executeRawUnsafe(
          'TRUNCATE TABLE "Account", "Channel", "MediaUploadSession", "AccountDeletionRequest", "PrivacyMediaDeletionJob", "MediaProcessingOutputAttempt" CASCADE',
        );
        received.length = 0;
        uploads.clear();
        objects.clear();
        grants.clear();
        supported = true;
        failAuthorize = false;
        counters = { allocations: 0, authorizations: 0, puts: 0, completes: 0 };
      }
      if (typeof input.supported === "boolean") supported = input.supported;
      if (typeof input.failAuthorize === "boolean") failAuthorize = input.failAuthorize;
      reply.end('{"ok":true}');
      return;
    }
    if (request.method === "PUT") {
      storeGrantedBytes(request.url?.slice(1) ?? "", body);
      reply.end('{"ok":true}');
      return;
    }
    reply.writeHead(404).end("{}");
  } catch {
    reply.writeHead(409).end('{"error":"Synthetic provider rejection"}');
  }
});
await new Promise<void>((resolve) => provider.listen(3012, "127.0.0.1", resolve));
const close = async () => {
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
