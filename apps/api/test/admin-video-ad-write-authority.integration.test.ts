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
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe(
  "Video advertising writes retain current authority through settings and target waits",
  () => {
    const prisma = createPrismaClient(databaseUrl);
    let app: NestFastifyApplication;
    beforeAll(async () => {
      process.env.APP_ENV = "test";
      process.env.AUTH_TOKEN_SECRET = "video-ad-write-authority-secret-longer-than32";
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
      await prisma.adminAuditLog.deleteMany();
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });
    async function fixture(role: "ADMIN" | "AD_MANAGER" | "FINANCE_MANAGER" = "ADMIN") {
      const registration = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Actual ad authority operator",
          email: randomUUID() + "@example.test",
          password: "strong-pass-123",
        },
      });
      expect(registration.statusCode).toBe(201);
      const id = registration.json().user.account.id as string,
        header = registration.headers["set-cookie"],
        raw = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
      if (!raw) throw Error("Expected session");
      const { cookie } = await enrollTestMfa(app, raw);
      await prisma.adminRoleAssignment.create({ data: { accountId: id, role } });
      const channel = await prisma.channel.create({
        data: { name: "Actual ads owner", handle: "ad-owner-" + randomUUID().slice(0, 8) },
      });
      const video = await prisma.video.create({
        data: {
          channelId: channel.id,
          title: "Actual ad target",
          slug: "ad-target-" + randomUUID().slice(0, 8),
        },
      });
      const override = await prisma.videoAdOverride.create({
        data: { videoId: video.id, enabled: false, midRollEverySec: 600 },
      });
      const setting = await prisma.platformSetting.create({
        data: {
          namespace: "ADVERTISING",
          key: "videoAdsV1",
          valueType: "JSON",
          schemaVersion: 1,
          value: defaultVideoAdSettings,
        },
      });
      return { id, cookie, channel, video, override, setting };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    function send(f: Fixture, command: "SETTINGS" | "UPSERT" | "DELETE") {
      return Promise.resolve(
        app.inject({
          method: command === "DELETE" ? "DELETE" : "PATCH",
          url:
            command === "SETTINGS"
              ? "/admin/video-ads/settings"
              : "/admin/video-ads/videos/" + f.video.id,
          headers: { cookie: f.cookie, origin: "http://localhost:3000" },
          ...(command === "DELETE"
            ? {}
            : {
                payload:
                  command === "SETTINGS"
                    ? { ...defaultVideoAdSettings, frequencyCapPerSession: 5 }
                    : { midRollEverySec: 900 },
              }),
        }),
      );
    }
    async function facts(f: Fixture) {
      return {
        settings: await prisma.platformSetting.findUnique({ where: { id: f.setting.id } }),
        overrides: await prisma.videoAdOverride.findMany({ orderBy: { id: "asc" } }),
        audits: await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } }),
      };
    }
    async function observed(marker: string) {
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${"%" + marker + "%"}`,
          );
          expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
        },
        { timeout: 4000, interval: 25 },
      );
    }
    for (const command of ["SETTINGS", "UPSERT", "DELETE"] as const)
      for (const change of [
        "ROLE",
        "ACCOUNT",
        "AUTHVERSION",
        "SESSION",
        "MFA",
        "REAUTHTIME",
        "SESSIONEXPIRY",
      ] as const)
        it(`rejects actual ${change} winner for ${command} after an observed wait with no config or audit effects`, async () => {
          const f = await fixture(),
            before = await facts(f),
            targetWait = ["REAUTHTIME", "SESSIONEXPIRY"].includes(change);
          if (change === "SESSIONEXPIRY")
            await prisma.accountSession.updateMany({
              where: { accountId: f.id, revokedAt: null },
              data: { expiresAt: new Date(Date.now() + 1500) },
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
              if (!targetWait)
                await tx.$queryRaw(
                  Prisma.sql`SELECT "accountId" FROM "AccountMfaCredential" WHERE "accountId"=${f.id}::uuid FOR UPDATE`,
                );
              else if (command === "SETTINGS")
                await tx.$queryRaw(
                  Prisma.sql`SELECT "id" FROM "PlatformSetting" WHERE "id"=${f.setting.id}::uuid FOR UPDATE`,
                );
              else
                await tx.$queryRaw(
                  Prisma.sql`SELECT "id" FROM "Video" WHERE "id"=${f.video.id}::uuid FOR UPDATE`,
                );
              acquired();
              await gate;
              if (change === "MFA")
                await tx.accountMfaCredential.update({
                  where: { accountId: f.id },
                  data: { version: { increment: 1 } },
                });
            },
            { timeout: 15000 },
          );
          await locked;
          const pending = send(f, command);
          try {
            await observed(
              !targetWait
                ? "ayin-admin-account-write-lock"
                : command === "SETTINGS"
                  ? '"PlatformSetting"'
                  : "ayin-admin-video-ad-target-lock",
            );
            if (change === "ROLE")
              await prisma.adminRoleAssignment.deleteMany({ where: { accountId: f.id } });
            if (change === "ACCOUNT")
              await prisma.account.update({ where: { id: f.id }, data: { status: "SUSPENDED" } });
            if (change === "AUTHVERSION")
              await prisma.account.update({
                where: { id: f.id },
                data: { authVersion: { increment: 1 } },
              });
            if (change === "SESSION")
              await prisma.accountSession.updateMany({
                where: { accountId: f.id },
                data: { revokedAt: new Date(), revokeReason: "CONTROLLED_AD_AUTHORITY_WINNER" },
              });
            if (change === "REAUTHTIME") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
            if (change === "SESSIONEXPIRY")
              await vi.waitFor(
                async () => {
                  const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>(
                    Prisma.sql`SELECT bool_and("expiresAt"<=clock_timestamp()) AS expired FROM "AccountSession" WHERE "accountId"=${f.id}::uuid AND "revokedAt" IS NULL`,
                  );
                  expect(row?.expired).toBe(true);
                },
                { timeout: 3000, interval: 25 },
              );
          } finally {
            release();
          }
          await holder;
          const response = await pending;
          vi.restoreAllMocks();
          expect(response.statusCode).toBe(
            change === "ROLE" || change === "REAUTHTIME" ? 403 : 401,
          );
          expect(await facts(f)).toEqual(before);
        });
    for (const command of ["SETTINGS", "UPSERT", "DELETE"] as const)
      it(`rolls back actual ${command} config when its final audit fails, before one explicit retry`, async () => {
        const f = await fixture(),
          before = await facts(f);
        await prisma.$executeRawUnsafe(
          `CREATE FUNCTION reject_video_ad_authority_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'VIDEO_AD_%' THEN RAISE EXCEPTION 'controlled ad audit failure'; END IF; RETURN NEW; END; $$`,
        );
        await prisma.$executeRawUnsafe(
          'CREATE TRIGGER reject_video_ad_authority_audit BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION reject_video_ad_authority_audit()',
        );
        try {
          expect((await send(f, command)).statusCode).toBe(500);
          expect(await facts(f)).toEqual(before);
        } finally {
          await prisma.$executeRawUnsafe(
            'DROP TRIGGER IF EXISTS reject_video_ad_authority_audit ON "AdminAuditLog"',
          );
          await prisma.$executeRawUnsafe(
            "DROP FUNCTION IF EXISTS reject_video_ad_authority_audit()",
          );
        }
        expect((await send(f, command)).statusCode).toBe(200);
        expect(await prisma.adminAuditLog.count()).toBe(before.audits.length + 1);
      });
    it("allows scoped AD_MANAGER writes and actual cascaded-target cleanup without granting account/TV/video authority; Finance is denied and invalid schema stays400", async () => {
      const f = await fixture("AD_MANAGER");
      for (const command of ["SETTINGS", "UPSERT", "DELETE"] as const)
        expect((await send(f, command)).statusCode).toBe(200);
      for (const method of ["PATCH", "DELETE"] as const)
        expect(
          (
            await app.inject({
              method,
              url: "/admin/video-ads/channels/" + f.channel.id,
              headers: { cookie: f.cookie, origin: "http://localhost:3000" },
              ...(method === "PATCH" ? { payload: { enabled: false } } : {}),
            })
          ).statusCode,
        ).toBe(200);
      for (const url of ["/admin/control/users", "/admin/control/tv", "/admin/control/videos"])
        expect(
          (await app.inject({ method: "GET", url, headers: { cookie: f.cookie } })).statusCode,
        ).toBe(403);
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: "/admin/video-ads/settings",
            headers: { cookie: f.cookie, origin: "http://localhost:3000" },
            payload: { masterEnabled: true },
          })
        ).statusCode,
      ).toBe(400);
      const registration = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Actual denied Finance",
          email: randomUUID() + "@example.test",
          password: "strong-pass-123",
        },
      });
      const header = registration.headers["set-cookie"],
        raw = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
      if (!raw) throw Error("Expected finance session");
      const { cookie } = await enrollTestMfa(app, raw);
      await prisma.adminRoleAssignment.create({
        data: { accountId: registration.json().user.account.id, role: "FINANCE_MANAGER" },
      });
      const before = await facts(f);
      for (const command of ["SETTINGS", "UPSERT", "DELETE"] as const)
        expect((await send({ ...f, cookie }, command)).statusCode).toBe(403);
      expect(await facts(f)).toEqual(before);
      await prisma.videoAdOverride.create({ data: { videoId: f.video.id, enabled: false } });
      await prisma.video.delete({ where: { id: f.video.id } });
      expect(
        await prisma.videoAdOverride.findUnique({ where: { videoId: f.video.id } }),
      ).toBeNull();
      const cascaded = await facts(f);
      expect((await send(f, "UPSERT")).statusCode).toBe(404);
      expect(await facts(f)).toEqual(cascaded);
      const removed = await send(f, "DELETE");
      expect(removed.statusCode).toBe(200);
      expect(removed.json()).toEqual({ deleted: false });
      expect((await facts(f)).audits).toHaveLength(cascaded.audits.length + 1);
    });
  },
);
