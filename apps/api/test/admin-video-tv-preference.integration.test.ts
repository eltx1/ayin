import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { enrollTestMfa } from "./mfa-test-helper.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Admin video exact TV inclusion snapshots and preference authority", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "admin-video-write-test-secret-longer-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
    await prisma.adminAuditLog.deleteMany();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function actor(role: "ADMIN" | "FINANCE_MANAGER" | "CONTENT_MODERATOR" = "ADMIN") {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual video actor",
        email: `video-authority-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const id = response.json().user.account.id as string;
    const header = response.headers["set-cookie"],
      raw = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
    if (!raw) throw Error("Expected session");
    const { cookie } = await enrollTestMfa(app, raw);
    await prisma.adminRoleAssignment.create({ data: { accountId: id, role } });
    return { id, cookie };
  }
  async function fixture() {
    const a = await actor();
    const channel = await prisma.channel.create({
      data: { name: "Actual video owner", handle: "actual-video-owner" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        title: "Actual original video",
        slug: "actual-original-video",
        status: "PUBLISHED",
        updatedAt: new Date("2035-01-01T00:00:00Z"),
      },
    });
    return { ...a, video, channel };
  }
  async function tvFixture() {
    const f = await fixture();
    const tv = await prisma.creatorTvChannel.create({
      data: {
        channelId: f.channel.id,
        name: "Actual original TV",
        slug: "actual-original-tv",
        createdAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
    return { ...f, tv };
  }
  async function read(f: Awaited<ReturnType<typeof fixture>>) {
    const response = await app.inject({
      method: "GET",
      url: `/admin/control/videos/${f.video.id}`,
      headers: { cookie: f.cookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }
  function save(
    f: Awaited<ReturnType<typeof tvFixture>>,
    version: string | null,
    included = false,
    status?: "REMOVED",
  ) {
    return Promise.resolve(
      app.inject({
        method: "PATCH",
        url: `/admin/control/videos/${f.video.id}`,
        headers: { cookie: f.cookie, origin: "http://localhost:3000" },
        payload: {
          title: "Actual revised title",
          tvIncluded: included,
          expectedUpdatedAt: f.video.updatedAt.toISOString(),
          expectedTvPreference: { tvChannelId: f.tv.id, updatedAt: version },
          reason: "Actual reviewed TV preference",
          ...(status ? { status } : {}),
        },
      }),
    );
  }
  async function observed(marker: string) {
    await vi.waitFor(
      async () => {
        const [row] = await prisma.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${"%" + marker + "%"}`,
        );
        expect(Number(row?.count ?? 0)).toBeGreaterThanOrEqual(1);
      },
      { timeout: 4000, interval: 25 },
    );
  }
  it("returns real no-TV/default/explicit facts for the actual deterministic edit destination rather than the first unrelated preference", async () => {
    const f = await fixture();
    expect((await read(f)).tvControl).toBeNull();
    const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
    const tvs = await Promise.all(
      ids.map((id, i) =>
        prisma.creatorTvChannel.create({
          data: {
            id,
            channelId: f.channel.id,
            name: `Actual TV ${i}`,
            slug: `actual-tv-${i}`,
            createdAt: new Date("2020-01-01T00:00:00Z"),
          },
        }),
      ),
    );
    await prisma.creatorTvVideoPreference.create({
      data: { tvChannelId: tvs[1]!.id, videoId: f.video.id, included: false, priority: -100000 },
    });
    const initial = await read(f);
    expect(initial.tvControl).toEqual({
      id: tvs[0]!.id,
      name: tvs[0]!.name,
      status: "ACTIVE",
      included: true,
      origin: "DEFAULT",
      updatedAt: null,
    });
    expect(initial.channel).not.toHaveProperty("creatorTvChannels");
    const preference = await prisma.creatorTvVideoPreference.create({
      data: {
        tvChannelId: tvs[0]!.id,
        videoId: f.video.id,
        included: false,
        updatedAt: new Date("2037-01-01T00:00:00Z"),
      },
    });
    expect((await read(f)).tvControl).toEqual({
      ...initial.tvControl,
      included: false,
      origin: "EXPLICIT",
      updatedAt: preference.updatedAt.toISOString(),
    });
    const directory = await app.inject({
      method: "GET",
      url: "/admin/control/videos",
      headers: { cookie: f.cookie },
    });
    expect(directory.json().items[0].tvControl).toEqual((await read(f)).tvControl);
  });
  it("rejects an actual new explicit preference that superseded a default snapshot without changing video or audit", async () => {
    const f = await tvFixture();
    const before = await read(f);
    expect(before.tvControl.updatedAt).toBeNull();
    const winner = await prisma.creatorTvVideoPreference.create({
      data: { tvChannelId: f.tv.id, videoId: f.video.id, included: false },
    });
    const audits = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    expect((await save(f, null, true)).statusCode).toBe(409);
    expect(await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } })).toEqual(f.video);
    expect(
      await prisma.creatorTvVideoPreference.findUniqueOrThrow({ where: { id: winner.id } }),
    ).toEqual(winner);
    expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(audits);
  });
  for (const change of ["PREFERENCE", "REAUTHTIME", "DELETED_TV"] as const)
    it(`rejects actual ${change} winner after an observed preference/TV wait and rolls back root metadata`, async () => {
      const f = await tvFixture();
      const preference =
        change === "DELETED_TV"
          ? null
          : await prisma.creatorTvVideoPreference.create({
              data: {
                tvChannelId: f.tv.id,
                videoId: f.video.id,
                included: true,
                updatedAt: new Date("2037-01-01T00:00:00Z"),
              },
            });
      const audits = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => {
          acquired = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      const holder = prisma.$transaction(
        async (tx) => {
          if (preference)
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "CreatorTvVideoPreference" WHERE id=${preference.id}::uuid FOR UPDATE`,
            );
          else
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "CreatorTvChannel" WHERE id=${f.tv.id}::uuid FOR UPDATE`,
            );
          acquired();
          await gate;
          if (change === "PREFERENCE")
            await tx.creatorTvVideoPreference.update({
              where: { id: preference!.id },
              data: { included: false, updatedAt: new Date(preference!.updatedAt.getTime() + 1) },
            });
          if (change === "DELETED_TV") await tx.creatorTvChannel.delete({ where: { id: f.tv.id } });
        },
        { timeout: 15000 },
      );
      await locked;
      const pending = save(f, preference?.updatedAt.toISOString() ?? null, false);
      try {
        await observed(
          preference ? "ayin-admin-video-tv-preference-lock" : "ayin-admin-video-tv-lock",
        );
        if (change === "REAUTHTIME") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
      } finally {
        release();
      }
      await holder;
      const response = await pending;
      vi.restoreAllMocks();
      expect(response.statusCode).toBe(change === "REAUTHTIME" ? 403 : 409);
      expect(await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } })).toEqual(f.video);
      expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(audits);
      if (preference)
        expect(
          await prisma.creatorTvVideoPreference.findUniqueOrThrow({ where: { id: preference.id } }),
        ).toEqual(
          change === "PREFERENCE"
            ? {
                ...preference,
                included: false,
                updatedAt: new Date(preference.updatedAt.getTime() + 1),
              }
            : preference,
        );
    });
  it("commits one exact default-to-explicit preference acknowledgment and rejects unknown/malformed/mismatched TV context", async () => {
    const f = await tvFixture(),
      prior = await prisma.adminAuditLog.count();
    const response = await save(f, null, false);
    expect(response.statusCode).toBe(200);
    const current = await prisma.creatorTvVideoPreference.findUniqueOrThrow({
      where: { tvChannelId_videoId: { tvChannelId: f.tv.id, videoId: f.video.id } },
    });
    expect(response.json().tvControl).toEqual({
      id: f.tv.id,
      included: false,
      origin: "EXPLICIT",
      updatedAt: current.updatedAt.toISOString(),
    });
    expect(await prisma.adminAuditLog.count()).toBe(prior + 1);
    const version = (
      await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } })
    ).updatedAt.toISOString();
    for (const expected of [
      { tvChannelId: "not-a-uuid", updatedAt: null },
      { tvChannelId: f.tv.id, updatedAt: "yesterday" },
    ])
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/admin/control/videos/${f.video.id}`,
            headers: { cookie: f.cookie, origin: "http://localhost:3000" },
            payload: {
              tvIncluded: true,
              expectedTvPreference: expected,
              reason: "Actual reviewed context",
            },
          })
        ).statusCode,
      ).toBe(400);
    const wrong = await app.inject({
      method: "PATCH",
      url: `/admin/control/videos/${f.video.id}`,
      headers: { cookie: f.cookie, origin: "http://localhost:3000" },
      payload: {
        tvIncluded: true,
        expectedUpdatedAt: version,
        expectedTvPreference: { tvChannelId: randomUUID(), updatedAt: null },
        reason: "Actual reviewed context",
      },
    });
    expect(wrong.statusCode).toBe(409);
    expect(await prisma.adminAuditLog.count()).toBe(prior + 1);
  });
  it("rolls back actual video and preference on audit failure and retries once with monotonic future preference version", async () => {
    const f = await tvFixture(),
      preference = await prisma.creatorTvVideoPreference.create({
        data: {
          tvChannelId: f.tv.id,
          videoId: f.video.id,
          included: true,
          priority: -100000,
          sortOrder: 42,
          updatedAt: new Date("2037-01-01T00:00:00Z"),
        },
      });
    const audits = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION reject_video_pref_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='video.admin_updated' THEN RAISE EXCEPTION 'controlled preference audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER video_pref_audit_failure BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION reject_video_pref_audit()',
    );
    try {
      expect((await save(f, preference.updatedAt.toISOString())).statusCode).toBe(500);
      expect(await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } })).toEqual(f.video);
      expect(
        await prisma.creatorTvVideoPreference.findUniqueOrThrow({ where: { id: preference.id } }),
      ).toEqual(preference);
      expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(audits);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS video_pref_audit_failure ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_video_pref_audit()");
    }
    const response = await save(f, preference.updatedAt.toISOString());
    expect(response.statusCode).toBe(200);
    expect(response.json().tvControl.updatedAt).toBe(
      new Date(preference.updatedAt.getTime() + 1).toISOString(),
    );
    expect(
      await prisma.creatorTvVideoPreference.findUniqueOrThrow({ where: { id: preference.id } }),
    ).toMatchObject({ included: false, priority: -100000, sortOrder: 42 });
    expect(await prisma.adminAuditLog.count()).toBe(audits.length + 1);
  });
  it("acknowledges actual exclusion after removal even when the incoming inclusion flag was true, and advances every future preference version", async () => {
    const f = await tvFixture();
    const other = await prisma.creatorTvChannel.create({
      data: { channelId: f.channel.id, name: "Other actual TV", slug: "other-actual-tv" },
    });
    const preferences = await Promise.all(
      [f.tv, other].map((tv) =>
        prisma.creatorTvVideoPreference.create({
          data: {
            tvChannelId: tv.id,
            videoId: f.video.id,
            included: true,
            updatedAt: new Date("2037-01-01T00:00:00Z"),
          },
        }),
      ),
    );
    const response = await save(f, preferences[0]!.updatedAt.toISOString(), true, "REMOVED");
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("REMOVED");
    const rows = await prisma.creatorTvVideoPreference.findMany({ where: { videoId: f.video.id } });
    expect(
      rows.every(
        (r) =>
          !r.included &&
          r.updatedAt.getTime() > preferences.find((p) => p.id === r.id)!.updatedAt.getTime(),
      ),
    ).toBe(true);
    expect(response.json().tvControl).toEqual({
      id: f.tv.id,
      included: false,
      origin: "EXPLICIT",
      updatedAt: rows.find((r) => r.tvChannelId === f.tv.id)!.updatedAt.toISOString(),
    });
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorAccountId: f.id, action: "video.admin_updated", entityId: f.video.id },
    });
    expect(audit.metadata).toMatchObject({ status: "REMOVED", tvIncluded: false });
  });
});
