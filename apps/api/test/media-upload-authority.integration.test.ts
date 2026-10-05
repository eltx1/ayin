import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";
import { SessionService } from "../src/auth/session.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const sizeBytes = 70 * 1024 * 1024;
const paths = ["authorize-part", "resume", "complete", "abort"] as const;
type Path = (typeof paths)[number];
const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "actual-authority-upload" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/single",
    expiresAt: new Date(Date.now() + 60000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({ sizeBytes, contentType: "video/mp4", etag: '"complete"' })),
  deleteObject: vi.fn(async () => undefined),
  deletePrefix: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};
function cookiePair(value: string | string[] | undefined) {
  const result = (Array.isArray(value) ? value[0] : value)?.split(";", 1)[0];
  if (!result) throw Error("Expected actual session cookie");
  return result;
}

databaseDescribe("Current administrator upload continuation authority", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "actual-upload-authority-auth-secret-more-than32";
    process.env.UPLOAD_SESSION_SECRET = "actual-upload-authority-session-secret-more-than32";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.adminAuditLog.deleteMany();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register() {
    const email = `upload-authority-${randomUUID()}@example.com`;
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Actual upload actor", email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    return {
      cookie: cookiePair(response.headers["set-cookie"]),
      email,
      accountId: response.json().user.account.id as string,
      channelId: response.json().user.channel.id as string,
    };
  }
  async function fixture(
    role: "OPERATIONS" | "CONTENT_MODERATOR" | "ADMIN" = "OPERATIONS",
    bytes = sizeBytes,
  ) {
    const actor = await register();
    if (role === "ADMIN") actor.cookie = (await enrollTestMfa(app, actor.cookie)).cookie;
    await prisma.adminRoleAssignment.create({ data: { accountId: actor.accountId, role } });
    const owner = await register();
    await prisma.channel.update({
      where: { id: owner.channelId },
      data: { isPlatformOwned: true },
    });
    const batch = await app.inject({
      method: "POST",
      url: "/admin/content-seeding/batches",
      headers: { cookie: actor.cookie },
      payload: {
        channelId: owner.channelId,
        sourceLabel: "Actual reviewed catalog",
        items: [
          {
            title: "Authority fixture",
            contentType: "DOCUMENTARY",
            rightsBasis: "OWNED",
            sourceNotes: "Owned isolated integration source",
          },
        ],
      },
    });
    expect(batch.statusCode).toBe(201);
    const item = batch.json().items[0];
    const created = await app.inject({
      method: "POST",
      url: `/admin/content-seeding/items/${item.id}/upload-session`,
      headers: { cookie: actor.cookie },
      payload: { sizeBytes: bytes, mimeType: "video/mp4" },
    });
    expect(created.statusCode).toBe(201);
    vi.clearAllMocks();
    return {
      actor,
      owner,
      videoId: item.video.id as string,
      session: created.json() as {
        sessionToken: string;
        assetId: string;
        partCount?: number;
        objectKey: string;
      },
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function send(f: Fixture, path: Path, cookie = f.actor.cookie) {
    return Promise.resolve(
      app.inject({
        method: "POST",
        url: `/media/uploads/sessions/${path}`,
        headers: { cookie },
        payload: {
          sessionToken: f.session.sessionToken,
          ...(path === "authorize-part" ? { partNumber: 1 } : {}),
          ...(path === "complete"
            ? {
                parts: Array.from({ length: f.session.partCount ?? 0 }, (_, i) => ({
                  partNumber: i + 1,
                  etag: `"part-${i + 1}"`,
                })),
              }
            : {}),
        },
      }),
    );
  }
  async function state(f: Fixture) {
    return {
      asset: await prisma.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId } }),
      video: await prisma.video.findUniqueOrThrow({ where: { id: f.videoId } }),
      jobs: await prisma.mediaProcessingJob.findMany({
        where: { videoId: f.videoId },
        orderBy: { id: "asc" },
      }),
    };
  }
  function noProviderCalls() {
    for (const value of Object.values(storage))
      if (typeof value === "function") expect(value).not.toHaveBeenCalled();
  }
  async function denyAll(f: Fixture, status: number) {
    const before = await state(f);
    for (const path of paths) expect((await send(f, path)).statusCode, path).toBe(status);
    expect(await state(f)).toEqual(before);
    noProviderCalls();
  }

  for (const role of [null, "FINANCE_MANAGER", "AD_MANAGER"] as const)
    it(`rejects a genuine old admin upload token after supported demotion to ${role ?? "no role"} and fresh login`, async () => {
      const f = await fixture();
      const superadmin = await register();
      superadmin.cookie = (await enrollTestMfa(app, superadmin.cookie)).cookie;
      await prisma.adminRoleAssignment.create({
        data: { accountId: superadmin.accountId, role: "SUPERADMIN" },
      });
      const demotion = await app.inject({
        method: "PATCH",
        url: `/admin/operations/staff/${f.actor.accountId}/roles`,
        headers: { cookie: superadmin.cookie },
        payload: { roles: role ? [role] : [], reason: "Reviewed isolated authority change" },
      });
      expect(demotion.statusCode).toBe(200);
      expect((await send(f, "resume")).statusCode).toBe(401);
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: f.actor.email, password: "strong-pass-123" },
      });
      expect(login.statusCode).toBe(200);
      f.actor.cookie = cookiePair(login.headers["set-cookie"]);
      await denyAll(f, 403);
    });
  it("rejects expired step-up on every continuation while the signed upload token is still valid", async () => {
    const f = await fixture();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
    await denyAll(f, 403);
  });
  for (const change of ["ASSURANCE", "VERSION", "DISABLED"] as const)
    it(`rejects current privileged MFA ${change} without provider calls`, async () => {
      const f = await fixture("ADMIN");
      if (change === "ASSURANCE") {
        const account = await prisma.account.findUniqueOrThrow({
          where: { id: f.actor.accountId },
        });
        const token = await app
          .get(SessionService)
          .create(account.id, account.authVersion, { reauthAt: Math.floor(Date.now() / 1000) }, {});
        f.actor.cookie = `ayin_session=${token}`;
      } else
        await prisma.accountMfaCredential.update({
          where: { accountId: f.actor.accountId },
          data: change === "VERSION" ? { version: { increment: 1 } } : { status: "PENDING" },
        });
      await denyAll(f, 401);
    });
  for (const target of ["CHANNEL", "CHANNEL_TOMBSTONE", "VIDEO", "ASSET"] as const)
    it(`rejects removed ${target} lifecycle before provider calls`, async () => {
      const f = await fixture();
      if (target === "CHANNEL")
        await prisma.channel.update({
          where: { id: f.owner.channelId },
          data: { status: "REMOVED" },
        });
      if (target === "CHANNEL_TOMBSTONE")
        await prisma.channel.update({
          where: { id: f.owner.channelId },
          data: { removedAt: new Date() },
        });
      if (target === "VIDEO")
        await prisma.video.update({
          where: { id: f.videoId },
          data: { status: "REMOVED", removedAt: new Date() },
        });
      if (target === "ASSET")
        await prisma.mediaAsset.update({
          where: { id: f.session.assetId },
          data: { removedAt: new Date() },
        });
      await denyAll(f, 409);
    });
  for (const role of ["OPERATIONS", "CONTENT_MODERATOR", "ADMIN"] as const)
    it(`preserves valid ${role} continuation and idempotent processing generation`, async () => {
      const f = await fixture(role);
      expect((await send(f, "authorize-part")).statusCode).toBe(201);
      expect((await send(f, "resume")).statusCode).toBe(201);
      expect((await send(f, "complete")).statusCode).toBe(201);
      expect((await send(f, "complete")).statusCode).toBe(201);
      expect(storage.completeMultipartUpload).toHaveBeenCalledOnce();
      expect(await prisma.mediaProcessingJob.count({ where: { videoId: f.videoId } })).toBe(1);
    });

  for (const path of paths)
    it(`rechecks session revocation while ${path} provider response is pending without holding staff locks`, async () => {
      const f = await fixture();
      const before = await state(f);
      const method =
        path === "authorize-part"
          ? storage.authorizeMultipartPart
          : path === "resume"
            ? storage.listParts
            : path === "complete"
              ? storage.completeMultipartUpload
              : storage.abortMultipartUpload;
      let entered!: () => void, release!: () => void;
      const pending = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const wait = async () => {
        entered();
        await gate;
      };
      if (path === "authorize-part")
        vi.mocked(storage.authorizeMultipartPart).mockImplementationOnce(async () => {
          await wait();
          return { url: "https://example.invalid/part", expiresAt: new Date(Date.now() + 60000) };
        });
      if (path === "resume")
        vi.mocked(storage.listParts).mockImplementationOnce(async () => {
          await wait();
          return [];
        });
      if (path === "complete")
        vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async () => {
          await wait();
          return { etag: '"complete"' };
        });
      if (path === "abort") vi.mocked(storage.abortMultipartUpload).mockImplementationOnce(wait);
      const request = send(f, path);
      await pending;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
          await tx.$executeRawUnsafe(
            "DO $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1398034002); END $$;",
          );
          await tx.accountSession.updateMany({
            where: { accountId: f.actor.accountId },
            data: { revokedAt: new Date(), revokeReason: "CONTROLLED_PROVIDER_WAIT" },
          });
        });
      } finally {
        release();
      }
      const response = await request;
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain("https://example.invalid");
      expect(await state(f)).toEqual(before);
      expect(method).toHaveBeenCalledOnce();
    });

  for (const change of [
    "ROLE",
    "SESSION",
    "SESSION_EXPIRY",
    "ACCOUNT",
    "AUTH_VERSION",
    "STEP_UP",
  ] as const)
    it(`rejects actual ${change} winner after observed authority lock wait`, async () => {
      const f = await fixture();
      const before = await state(f);
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${f.actor.accountId}::uuid FOR UPDATE`,
          );
          acquired();
          await gate;
          if (change === "ROLE")
            await tx.adminRoleAssignment.deleteMany({ where: { accountId: f.actor.accountId } });
          if (change === "ACCOUNT")
            await tx.account.update({
              where: { id: f.actor.accountId },
              data: { status: "SUSPENDED" },
            });
          if (change === "AUTH_VERSION")
            await tx.account.update({
              where: { id: f.actor.accountId },
              data: { authVersion: { increment: 1 } },
            });
          if (change === "SESSION_EXPIRY")
            await tx.accountSession.updateMany({
              where: { accountId: f.actor.accountId },
              data: { expiresAt: new Date() },
            });
          if (change === "SESSION")
            await tx.accountSession.updateMany({
              where: { accountId: f.actor.accountId },
              data: { revokedAt: new Date(), revokeReason: "CONTROLLED_LOCK_WINNER" },
            });
        },
        { timeout: 15000 },
      );
      await locked;
      const request = send(f, "authorize-part");
      try {
        await vi.waitFor(
          async () => {
            const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
              Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-admin-account-write-lock%'`,
            );
            expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
          },
          { timeout: 4000, interval: 25 },
        );
        if (change === "STEP_UP") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
      } finally {
        release();
      }
      await holder;
      expect((await request).statusCode).toBe(
        ["SESSION", "SESSION_EXPIRY", "ACCOUNT", "AUTH_VERSION"].includes(change) ? 401 : 403,
      );
      expect(await state(f)).toEqual(before);
      noProviderCalls();
    });
  for (const target of ["CHANNEL", "CHANNEL_TOMBSTONE", "VIDEO", "ASSET"] as const)
    it(`rejects ${target} removal during provider completion without resurrecting source or processing`, async () => {
      const f = await fixture();
      vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async () => {
        if (target === "CHANNEL")
          await prisma.channel.update({
            where: { id: f.owner.channelId },
            data: { status: "REMOVED" },
          });
        if (target === "CHANNEL_TOMBSTONE")
          await prisma.channel.update({
            where: { id: f.owner.channelId },
            data: { removedAt: new Date() },
          });
        if (target === "VIDEO")
          await prisma.video.update({
            where: { id: f.videoId },
            data: { status: "REMOVED", removedAt: new Date() },
          });
        if (target === "ASSET")
          await prisma.mediaAsset.update({
            where: { id: f.session.assetId },
            data: { status: "REMOVED", removedAt: new Date() },
          });
        return { etag: '"provider-completed-before-removal-was-observed"' };
      });
      expect((await send(f, "complete")).statusCode).toBe(409);
      const after = await state(f);
      expect(after.asset.status).toBe(target === "ASSET" ? "REMOVED" : "PENDING");
      expect(after.video.status).toBe(target === "VIDEO" ? "REMOVED" : "UPLOADING");
      expect(after.jobs).toHaveLength(0);
      expect(storage.completeMultipartUpload).toHaveBeenCalledOnce();
    });

  it("rolls back source UPLOADED when processing enqueue fails, then permits explicit verified recovery", async () => {
    const f = await fixture();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ayin_test_reject_upload_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."videoId" = '${f.videoId}'::uuid THEN RAISE EXCEPTION 'Controlled upload enqueue failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER ayin_test_upload_job BEFORE INSERT ON "MediaProcessingJob" FOR EACH ROW EXECUTE FUNCTION ayin_test_reject_upload_job()',
    );
    const before = await state(f);
    try {
      expect((await send(f, "complete")).statusCode).toBe(500);
      expect(await state(f)).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER ayin_test_upload_job ON "MediaProcessingJob"');
      await prisma.$executeRawUnsafe("DROP FUNCTION ayin_test_reject_upload_job()");
    }
    vi.mocked(storage.completeMultipartUpload).mockRejectedValueOnce(
      new Error("Provider upload already completed"),
    );
    expect((await send(f, "complete")).statusCode).toBe(201);
    expect((await state(f)).jobs).toHaveLength(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(2);
  });

  it("rechecks authority on already UPLOADED duplicate completion before enqueue or acknowledgment", async () => {
    const f = await fixture();
    expect((await send(f, "complete")).statusCode).toBe(201);
    const before = await state(f);
    await prisma.adminRoleAssignment.deleteMany({ where: { accountId: f.actor.accountId } });
    vi.clearAllMocks();
    expect((await send(f, "complete")).statusCode).toBe(403);
    expect(await state(f)).toEqual(before);
    noProviderCalls();
  });

  it("preserves explicit valid admin abort", async () => {
    const f = await fixture();
    expect((await send(f, "abort")).json()).toEqual({ status: "ABORTED" });
    expect((await state(f)).asset.status).toBe("REJECTED");
    expect(storage.abortMultipartUpload).toHaveBeenCalledOnce();
  });
  for (const expiry of ["STEP_UP", "UPLOAD_TOKEN"] as const)
    it(`rechecks ${expiry} after an observed source lock wait following initial authority verification`, async () => {
      const f = await fixture();
      const before = await state(f);
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "MediaAsset" WHERE "id" = ${f.session.assetId}::uuid FOR UPDATE`,
          );
          acquired();
          await gate;
        },
        { timeout: 15000 },
      );
      await locked;
      const request = send(f, "authorize-part");
      try {
        await vi.waitFor(
          async () => {
            const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
              Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-upload-source-lock%'`,
            );
            expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
          },
          { timeout: 4000, interval: 25 },
        );
        vi.spyOn(Date, "now").mockReturnValue(
          Date.now() + (expiry === "STEP_UP" ? 301000 : 901000),
        );
      } finally {
        release();
      }
      await holder;
      expect((await request).statusCode).toBe(expiry === "STEP_UP" ? 403 : 401);
      expect(await state(f)).toEqual(before);
      noProviderCalls();
    });
  for (const path of ["complete", "abort"] as const)
    it(`denies single-upload ${path} when current authority is revoked during provider work`, async () => {
      const f = await fixture("OPERATIONS", 1024);
      const before = await state(f);
      const revoke = async () => {
        await prisma.accountSession.updateMany({
          where: { accountId: f.actor.accountId },
          data: { revokedAt: new Date(), revokeReason: "CONTROLLED_SINGLE_PROVIDER" },
        });
      };
      if (path === "complete")
        vi.mocked(storage.headObject).mockImplementationOnce(async () => {
          await revoke();
          return { sizeBytes: 1024, contentType: "video/mp4", etag: '"single"' };
        });
      else vi.mocked(storage.deleteObject).mockImplementationOnce(revoke);
      expect((await send(f, path)).statusCode).toBe(401);
      expect(await state(f)).toEqual(before);
      expect(
        path === "complete" ? storage.headObject : storage.deleteObject,
      ).toHaveBeenCalledOnce();
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    });

  it("serializes simultaneous explicit HTTP completions into one processing generation", async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const complete = async () => {
      await gate;
      return { etag: '"completed"' };
    };
    vi.mocked(storage.completeMultipartUpload)
      .mockImplementationOnce(complete)
      .mockImplementationOnce(complete);
    const requests = [send(f, "complete"), send(f, "complete")];
    try {
      await vi.waitFor(() => expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(2), {
        timeout: 4000,
        interval: 25,
      });
    } finally {
      release();
    }
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    const after = await state(f);
    expect(after.asset.status).toBe("UPLOADED");
    expect(after.jobs).toHaveLength(1);
    expect(after.jobs[0]!.generation).toBe(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(2);
  });

  it("allows worker finalization to win an observed source-lock race against duplicate HTTP completion", async () => {
    const f = await fixture();
    expect((await send(f, "complete")).statusCode).toBe(201);
    const job = (await state(f)).jobs[0]!;
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: {
        status: "PROCESSING",
        leaseOwner: "actual-upload-race-worker",
        leaseExpiresAt: new Date(Date.now() + 60000),
      },
    });
    vi.clearAllMocks();
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "MediaAsset" WHERE "id" = ${f.session.assetId}::uuid FOR UPDATE`,
        );
        acquired();
        await gate;
      },
      { timeout: 15000 },
    );
    await locked;
    const worker = app.get(MediaProcessingLifecycleService).finalizeReady({
      jobId: job.id,
      workerId: "actual-upload-race-worker",
      metadata: { sizeBytes: 4096, durationMs: 1000, width: 640, height: 360 },
    });
    let request: ReturnType<typeof send> | undefined;
    try {
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE%MediaAsset%'`,
          );
          expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
        },
        { timeout: 4000, interval: 25 },
      );
      request = send(f, "complete");
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-upload-source-lock%'`,
          );
          expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
        },
        { timeout: 4000, interval: 25 },
      );
    } finally {
      release();
    }
    await holder;
    const finalized = await worker;
    expect(finalized?.job.status).toBe("READY");
    expect(finalized?.asset.status).toBe("VALIDATED");
    expect((await request!).statusCode).toBe(409);
    const after = await state(f);
    expect(after.asset.status).toBe("REMOVED");
    expect(after.video.status).toBe("DRAFT");
    expect(after.jobs).toHaveLength(1);
    noProviderCalls();
  });
});
