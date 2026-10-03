import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { defaultVideoAdSettings } from "../src/ads/video-ad.service.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("Captured advertising configuration versions", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "advertising-version-secret-longer-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "VideoAdOverride" CASCADE',
    );
    await prisma.platformSetting.deleteMany({
      where: { namespace: "ADVERTISING", key: "videoAdsV1" },
    });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function actor(role: "AD_MANAGER" | "FINANCE_MANAGER" = "AD_MANAGER") {
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual directory operator",
        email: randomUUID() + "@example.test",
        password: "strong-pass-123",
      },
    });
    expect(registered.statusCode).toBe(201);
    const id = registered.json().user.account.id as string;
    const headers = registered.headers["set-cookie"],
      raw = (Array.isArray(headers) ? headers[0] : headers)?.split(";", 1)[0];
    if (!raw) throw Error("Expected actual session");
    const { cookie } = await enrollTestMfa(app, raw);
    await prisma.adminRoleAssignment.create({ data: { accountId: id, role } });
    return { id, cookie };
  }

  type Actor = Awaited<ReturnType<typeof actor>>;
  const origin = "http://localhost:3000";
  const settingsUrl = "/admin/video-ads/settings";
  function command(
    a: Actor,
    url: string,
    payload: Record<string, unknown>,
    method: "PATCH" | "DELETE" = "PATCH",
  ) {
    return Promise.resolve(
      app.inject({ method, url, headers: { cookie: a.cookie, origin }, payload }),
    );
  }
  async function facts() {
    return {
      settings: await prisma.platformSetting.findMany({
        where: { namespace: "ADVERTISING", key: "videoAdsV1" },
      }),
      overrides: await prisma.videoAdOverride.findMany({ orderBy: { id: "asc" } }),
      audits: await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } }),
    };
  }
  async function target() {
    const channel = await prisma.channel.create({
      data: { name: "Actual version target", handle: "version-owner" },
    });
    const video = await prisma.video.create({
      data: { channelId: channel.id, title: "Actual version video", slug: "version-video" },
    });
    return { channel, video, url: "/admin/video-ads/videos/" + video.id };
  }

  it("checks actual missing and stored settings versions without reverting a winning legacy change", async () => {
    const a = await actor();
    const saved = await command(a, settingsUrl, {
      ...defaultVideoAdSettings,
      expectedUpdatedAt: null,
    });
    expect(saved.statusCode).toBe(200);
    const old = (await facts()).settings[0];
    if (!old) throw Error("Expected stored settings");
    expect(
      (await command(a, settingsUrl, { ...defaultVideoAdSettings, frequencyCapPerSession: 5 }))
        .statusCode,
    ).toBe(200);
    const winner = await facts();
    expect(winner.settings[0]?.updatedAt.getTime()).toBeGreaterThan(old.updatedAt.getTime());
    for (const expectedUpdatedAt of [null, old.updatedAt.toISOString()]) {
      expect(
        (await command(a, settingsUrl, { ...defaultVideoAdSettings, expectedUpdatedAt }))
          .statusCode,
      ).toBe(409);
      expect(await facts()).toEqual(winner);
    }
  });

  it("advances future settings versions and retains actual configuration on audit failure before explicit retry", async () => {
    const a = await actor(),
      future = new Date("2037-01-01T00:00:00Z");
    await prisma.platformSetting.create({
      data: {
        namespace: "ADVERTISING",
        key: "videoAdsV1",
        valueType: "JSON",
        value: defaultVideoAdSettings,
        updatedAt: future,
      },
    });
    const before = await facts();
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION ayin_ad_version_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'VIDEO_AD_SETTINGS_UPDATED' THEN RAISE EXCEPTION 'Actual version audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ayin_ad_version_audit_failure BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_ad_version_audit_failure()`,
    );
    const payload = {
      ...defaultVideoAdSettings,
      frequencyCapPerSession: 5,
      expectedUpdatedAt: future.toISOString(),
    };
    try {
      expect((await command(a, settingsUrl, payload)).statusCode).toBe(500);
      expect(await facts()).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS ayin_ad_version_audit_failure ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ayin_ad_version_audit_failure()");
    }
    expect((await command(a, settingsUrl, payload)).statusCode).toBe(200);
    const after = await facts();
    expect(after.settings[0]?.updatedAt.getTime()).toBe(future.getTime() + 1);
    expect(after.audits).toHaveLength(before.audits.length + 1);
  });

  it("creates an actual default override once and rejects superseded absent versions with safe acknowledgements", async () => {
    const a = await actor(),
      t = await target();
    const result = await command(a, t.url, { enabled: false, expectedUpdatedAt: null });
    expect(result.statusCode).toBe(200);
    expect(Object.keys(result.json()).sort()).toEqual(
      [
        "id",
        "channelId",
        "videoId",
        "enabled",
        "preRollEnabled",
        "midRollEnabled",
        "postRollEnabled",
        "provider",
        "vastTagUrl",
        "midRollEverySec",
        "updatedAt",
      ].sort(),
    );
    const before = await facts();
    expect((await command(a, t.url, { enabled: true, expectedUpdatedAt: null })).statusCode).toBe(
      409,
    );
    expect(await facts()).toEqual(before);
    expect(
      (await command(a, t.url, { enabled: false, expectedUpdatedAt: result.json().updatedAt }))
        .statusCode,
    ).toBe(200);
    expect((await facts()).overrides[0]?.updatedAt.getTime()).toBeGreaterThan(
      new Date(result.json().updatedAt).getTime(),
    );
  });

  it("preserves actual future override winners for stale patch and delete and accepts the current explicit delete", async () => {
    const a = await actor(),
      t = await target(),
      future = new Date("2037-01-01T00:00:00Z");
    const initial = await prisma.videoAdOverride.create({
      data: { videoId: t.video.id, enabled: false, updatedAt: future },
    });
    const changed = await command(a, t.url, {
      midRollEverySec: 900,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
    });
    expect(changed.statusCode).toBe(200);
    expect(new Date(changed.json().updatedAt).getTime()).toBe(future.getTime() + 1);
    const before = await facts();
    expect(
      (
        await command(a, t.url, {
          enabled: true,
          expectedUpdatedAt: initial.updatedAt.toISOString(),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await command(a, t.url, { expectedUpdatedAt: initial.updatedAt.toISOString() }, "DELETE"))
        .statusCode,
    ).toBe(409);
    expect(await facts()).toEqual(before);
    const deleted = await command(
      a,
      t.url,
      { expectedUpdatedAt: changed.json().updatedAt },
      "DELETE",
    );
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    const actual = await facts();
    expect(actual.overrides).toEqual([]);
    expect(actual.audits).toHaveLength(before.audits.length + 1);
    expect(
      (await command(a, t.url, { expectedUpdatedAt: changed.json().updatedAt }, "DELETE"))
        .statusCode,
    ).toBe(409);
    expect(await facts()).toEqual(actual);
  });

  it("retains independent actual channel and video versions and rejects malformed write versions", async () => {
    const a = await actor(),
      t = await target(),
      channelUrl = "/admin/video-ads/channels/" + t.channel.id;
    const channel = await command(a, channelUrl, { enabled: false, expectedUpdatedAt: null });
    expect(channel.statusCode).toBe(200);
    const video = await command(a, t.url, { enabled: false, expectedUpdatedAt: null });
    expect(video.statusCode).toBe(200);
    const before = await facts();
    for (const expectedUpdatedAt of ["not-a-date", 42]) {
      expect(
        (await command(a, settingsUrl, { ...defaultVideoAdSettings, expectedUpdatedAt }))
          .statusCode,
      ).toBe(400);
      expect((await command(a, t.url, { enabled: false, expectedUpdatedAt })).statusCode).toBe(400);
      expect((await command(a, channelUrl, { expectedUpdatedAt }, "DELETE")).statusCode).toBe(400);
    }
    expect(await facts()).toEqual(before);
    expect(
      (await command(a, channelUrl, { expectedUpdatedAt: channel.json().updatedAt }, "DELETE"))
        .statusCode,
    ).toBe(200);
    expect(
      await prisma.videoAdOverride.findUnique({ where: { videoId: t.video.id } }),
    ).toMatchObject({ id: video.json().id });
  });

  it("rejects an actual stored settings winner after an observed configuration row wait without new effects", async () => {
    const a = await actor();
    const row = await prisma.platformSetting.create({
      data: {
        namespace: "ADVERTISING",
        key: "videoAdsV1",
        valueType: "JSON",
        value: defaultVideoAdSettings,
      },
    });
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "PlatformSetting" WHERE "id"=${row.id}::uuid FOR UPDATE`,
        );
        acquired();
        await gate;
        await tx.platformSetting.update({
          where: { id: row.id },
          data: {
            value: { ...defaultVideoAdSettings, frequencyCapPerSession: 7 },
            updatedAt: new Date(row.updatedAt.getTime() + 1000),
          },
        });
      },
      { timeout: 15000 },
    );
    await locked;
    const pending = command(a, settingsUrl, {
      ...defaultVideoAdSettings,
      expectedUpdatedAt: row.updatedAt.toISOString(),
    });
    try {
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ayin-admin-video-ad-config-lock%'`,
          );
          expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0);
        },
        { timeout: 4000, interval: 25 },
      );
    } finally {
      release();
    }
    await holder;
    const before = await facts();
    expect((await pending).statusCode).toBe(409);
    expect(await facts()).toEqual(before);
  });

  it("serializes actual absent settings writers so one captured default wins with one domain audit", async () => {
    const a = await actor(),
      b = await actor(),
      before = await facts();
    const results = await Promise.all(
      [a, b].map((x) =>
        command(x, settingsUrl, { ...defaultVideoAdSettings, expectedUpdatedAt: null }),
      ),
    );
    expect(results.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    const after = await facts();
    expect(after.settings).toHaveLength(1);
    expect(after.audits).toHaveLength(before.audits.length + 1);
  });
});
