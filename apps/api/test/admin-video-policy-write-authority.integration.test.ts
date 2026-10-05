import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { AdminAuditLogService } from "../src/admin/admin-audit-log.service.js";
import { AdminGuard } from "../src/admin/admin.guard.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const commands = ["CLASSIFICATION", "OVERRIDE", "CLEAR"] as const;
type Command = (typeof commands)[number];
const classification = { maturityLevel: "GENERAL", ageRestriction: "NONE", kidsEligible: true };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function cookiePair(header: string | string[] | undefined) {
  const cookie = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
  if (!cookie) throw new Error("Expected a real session cookie.");
  return cookie;
}

databaseDescribe(
  "Admin video policy writes retain current authority and truthful audit state",
  () => {
    const prisma = createPrismaClient(databaseUrl);
    const createdChannelIds: string[] = [];
    let app: NestFastifyApplication;
    beforeAll(async () => {
      process.env.APP_ENV = "test";
      process.env.AUTH_TOKEN_SECRET = "video-policy-authority-test-secret-longer-than32";
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
      await prisma.homeRowConfig.deleteMany();
      await prisma.homeRowConfig.create({
        data: {
          key: "new-on-ayin",
          title: "Actual policy latest",
          source: "NEW_ON_AYIN",
          audience: "ALL",
          position: 1,
          maxItems: 10,
        },
      });
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      await app.close();
      // These channels are deliberately independent of the reviewer Account.
      // Remove our exact fixtures so later Account-only cleanup cannot leak videos.
      try {
        await prisma.video.deleteMany({ where: { channelId: { in: createdChannelIds } } });
        await prisma.channel.deleteMany({ where: { id: { in: createdChannelIds } } });
      } finally {
        await prisma.$disconnect();
      }
    });

    async function actor(
      role:
        "ADMIN" | "SUPERADMIN" | "OPERATIONS" | "CONTENT_MODERATOR" | "FINANCE_MANAGER" = "ADMIN",
      mfa = true,
    ) {
      const registration = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Actual policy reviewer",
          email: randomUUID() + "@example.test",
          password: "strong-pass-123",
        },
      });
      expect(registration.statusCode).toBe(201);
      const id = registration.json().user.account.id as string;
      const raw = cookiePair(registration.headers["set-cookie"]);
      const cookie = mfa ? (await enrollTestMfa(app, raw)).cookie : raw;
      await prisma.adminRoleAssignment.create({ data: { accountId: id, role } });
      const sessions = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { cookie },
      });
      const sessionId = (sessions.json().sessions as Array<{ id: string; current: boolean }>).find(
        (session) => session.current,
      )?.id;
      if (!sessionId) throw new Error("Expected current actual session.");
      return { id, cookie, sessionId };
    }
    async function fixture(role: Parameters<typeof actor>[0] = "ADMIN", mfa = true) {
      const reviewer = await actor(role, mfa);
      const channel = await prisma.channel.create({
        data: { name: "Actual policy channel", handle: "policy-" + randomUUID() },
      });
      createdChannelIds.push(channel.id);
      const video = await prisma.video.create({
        data: {
          channelId: channel.id,
          title: "Actual policy video",
          slug: "policy-" + randomUUID(),
          status: "PUBLISHED",
          visibility: "PUBLIC",
          publishedAt: new Date(),
          durationMs: 120000,
        },
      });
      await prisma.mediaAsset.create({
        data: {
          channelId: channel.id,
          videoId: video.id,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          r2ObjectKey: `test-policy/${video.id}/source.mp4`,
          mimeType: "video/mp4",
          sizeBytes: 1024n,
          durationMs: 120000,
        },
      });
      await prisma.videoPolicy.create({
        data: {
          videoId: video.id,
          maturityLevel: "TEEN",
          ageRestriction: "AGE_13_PLUS",
          kidsEligible: false,
        },
      });
      await prisma.videoPolicyOverride.create({
        data: {
          videoId: video.id,
          actorAccountId: reviewer.id,
          disposition: "FORCE_BLOCK",
          reason: "Original review restriction",
        },
      });
      return { ...reviewer, video };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    function send(f: Fixture, command: Command, payload?: Record<string, unknown>) {
      return Promise.resolve(
        app.inject({
          method: command === "CLEAR" ? "DELETE" : "PUT",
          url: `/admin/video-policies/${f.video.id}/${command === "CLASSIFICATION" ? "classification" : "override"}`,
          headers: { cookie: f.cookie, origin: "http://localhost:3000" },
          payload: payload ?? {
            ...(command === "CLASSIFICATION"
              ? classification
              : command === "OVERRIDE"
                ? { disposition: "FORCE_ALLOW", expiresAt: null }
                : {}),
            reason: "Actual reviewed policy update",
          },
        }),
      );
    }
    async function facts(f: Fixture) {
      return {
        policy: await prisma.videoPolicy.findUnique({ where: { videoId: f.video.id } }),
        override: await prisma.videoPolicyOverride.findUnique({ where: { videoId: f.video.id } }),
        audits: await prisma.adminAuditLog.findMany({
          where: { action: { startsWith: "video_policy." } },
          orderBy: { id: "asc" },
        }),
      };
    }
    async function observed(marker: string) {
      await vi.waitFor(
        async () => {
          const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*)::bigint AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${"%" + marker + "%"}`);
          expect(Number(row?.count ?? 0)).toBeGreaterThanOrEqual(1);
        },
        { timeout: 4000, interval: 25 },
      );
    }

    // Run the real guards, pause at their return boundary, then let an actual supported
    // authority mutation finish before the original controller/service may continue.
    for (const command of commands)
      for (const change of ["DEMOTION", "SESSION"] as const)
        it(`rejects supported ${change} after real guards for ${command}, without policy or audit effects`, async () => {
          const f = await fixture();
          const superadmin = change === "DEMOTION" ? await actor("SUPERADMIN") : null;
          const before = await facts(f);
          const entered = deferred(),
            release = deferred();
          const original = AdminGuard.prototype.canActivate;
          vi.spyOn(AdminGuard.prototype, "canActivate").mockImplementationOnce(async function (
            this: AdminGuard,
            context,
          ) {
            const result = await original.call(this, context);
            entered.resolve();
            await release.promise;
            return result;
          });
          const pending = send(f, command);
          try {
            await entered.promise;
            const winner =
              change === "DEMOTION"
                ? await app.inject({
                    method: "PATCH",
                    url: `/admin/operations/staff/${f.id}/roles`,
                    headers: { cookie: superadmin!.cookie },
                    payload: {
                      roles: ["FINANCE_MANAGER"],
                      reason: "Actual supported policy reviewer demotion",
                    },
                  })
                : await app.inject({
                    method: "DELETE",
                    url: `/auth/sessions/${f.sessionId}`,
                    headers: { cookie: f.cookie },
                  });
            expect(winner.statusCode).toBe(200);
            if (change === "DEMOTION") {
              expect(
                await prisma.adminRoleAssignment.findMany({
                  where: { accountId: f.id },
                  select: { role: true },
                }),
              ).toEqual([{ role: "FINANCE_MANAGER" }]);
            }
            expect(
              (await prisma.accountSession.findUniqueOrThrow({ where: { id: f.sessionId } }))
                .revokedAt,
            ).not.toBeNull();
          } finally {
            release.resolve();
          }
          expect((await pending).statusCode).toBe(401);
          expect(await facts(f)).toEqual(before);
        });

    for (const command of commands)
      for (const target of ["VIDEO", "POLICY"] as const)
        for (const change of ["STEP_UP", "SESSION_EXPIRY"] as const)
          it(`rejects stale ${change} after an observed ${target} lock wait for ${command}`, async () => {
            const f = await fixture(),
              before = await facts(f);
            if (change === "SESSION_EXPIRY")
              await prisma.accountSession.update({
                where: { id: f.sessionId },
                data: { expiresAt: new Date(Date.now() + 1500) },
              });
            const locked = deferred(),
              release = deferred();
            const holder = prisma.$transaction(
              async (tx) => {
                if (target === "VIDEO")
                  await tx.$queryRaw(
                    Prisma.sql`SELECT "id" FROM "Video" WHERE "id" = ${f.video.id}::uuid FOR UPDATE`,
                  );
                else if (command === "CLASSIFICATION")
                  await tx.$queryRaw(
                    Prisma.sql`SELECT "videoId" FROM "VideoPolicy" WHERE "videoId" = ${f.video.id}::uuid FOR UPDATE`,
                  );
                else
                  await tx.$queryRaw(
                    Prisma.sql`SELECT "videoId" FROM "VideoPolicyOverride" WHERE "videoId" = ${f.video.id}::uuid FOR UPDATE`,
                  );
                locked.resolve();
                await release.promise;
              },
              { timeout: 15000 },
            );
            await locked.promise;
            const pending = send(f, command);
            try {
              await observed(
                target === "VIDEO"
                  ? "ayin-admin-video-policy-target-lock"
                  : command === "CLASSIFICATION"
                    ? '"VideoPolicy"'
                    : '"VideoPolicyOverride"',
              );
              if (change === "STEP_UP") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
              else
                await vi.waitFor(
                  async () => {
                    const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>(
                      Prisma.sql`SELECT "expiresAt" <= clock_timestamp() AS expired FROM "AccountSession" WHERE "id" = ${f.sessionId}::uuid`,
                    );
                    expect(row?.expired).toBe(true);
                  },
                  { timeout: 3000, interval: 25 },
                );
            } finally {
              release.resolve();
            }
            await holder;
            const response = await pending;
            vi.restoreAllMocks();
            expect(response.statusCode).toBe(change === "STEP_UP" ? 403 : 401);
            expect(response.json().error.code).toBe(
              change === "STEP_UP" ? "STEP_UP_REQUIRED" : "UNAUTHORIZED",
            );
            expect(await facts(f)).toEqual(before);
          });

    for (const command of commands)
      for (const change of ["MFA", "ACCOUNT", "AUTH_VERSION", "ROLE", "SESSION_EXPIRY"] as const)
        it(`rejects ${change} after observed authority wait for ${command}`, async () => {
          const f = await fixture(),
            before = await facts(f);
          if (change === "SESSION_EXPIRY")
            await prisma.accountSession.update({
              where: { id: f.sessionId },
              data: { expiresAt: new Date(Date.now() + 1500) },
            });
          const locked = deferred(),
            release = deferred();
          const holder = prisma.$transaction(
            async (tx) => {
              await tx.$queryRaw(
                Prisma.sql`SELECT "accountId" FROM "AccountMfaCredential" WHERE "accountId" = ${f.id}::uuid FOR UPDATE`,
              );
              locked.resolve();
              await release.promise;
              if (change === "MFA")
                await tx.accountMfaCredential.update({
                  where: { accountId: f.id },
                  data: { version: { increment: 1 } },
                });
            },
            { timeout: 15000 },
          );
          await locked.promise;
          const pending = send(f, command);
          try {
            await observed("ayin-admin-account-write-lock");
            if (change === "ACCOUNT")
              await prisma.account.update({ where: { id: f.id }, data: { status: "SUSPENDED" } });
            if (change === "AUTH_VERSION")
              await prisma.account.update({
                where: { id: f.id },
                data: { authVersion: { increment: 1 } },
              });
            if (change === "ROLE")
              await prisma.adminRoleAssignment.deleteMany({ where: { accountId: f.id } });
            if (change === "SESSION_EXPIRY")
              await vi.waitFor(
                async () => {
                  const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>(
                    Prisma.sql`SELECT "expiresAt" <= clock_timestamp() AS expired FROM "AccountSession" WHERE "id" = ${f.sessionId}::uuid`,
                  );
                  expect(row?.expired).toBe(true);
                },
                { timeout: 3000, interval: 25 },
              );
          } finally {
            release.resolve();
          }
          await holder;
          expect((await pending).statusCode).toBe(change === "ROLE" ? 403 : 401);
          expect(await facts(f)).toEqual(before);
        });

    for (const command of commands)
      for (const change of ["REMOVED", "TOMBSTONE", "DELETED"] as const)
        it(`rejects ${change} target after observed Video wait for ${command}`, async () => {
          const f = await fixture(),
            before = await facts(f);
          const locked = deferred(),
            release = deferred();
          const holder = prisma.$transaction(
            async (tx) => {
              await tx.$queryRaw(
                Prisma.sql`SELECT "id" FROM "Video" WHERE "id" = ${f.video.id}::uuid FOR UPDATE`,
              );
              locked.resolve();
              await release.promise;
              if (change !== "DELETED")
                await tx.video.update({
                  where: { id: f.video.id },
                  data: {
                    ...(change === "REMOVED" ? { status: "REMOVED" as const } : {}),
                    removedAt: new Date(),
                  },
                });
              else await tx.video.delete({ where: { id: f.video.id } });
            },
            { timeout: 15000 },
          );
          await locked.promise;
          const pending = send(f, command);
          try {
            await observed("ayin-admin-video-policy-target-lock");
          } finally {
            release.resolve();
          }
          await holder;
          expect((await pending).statusCode).toBe(change === "DELETED" ? 404 : 409);
          expect(await facts(f)).toEqual(
            change !== "DELETED" ? before : { policy: null, override: null, audits: before.audits },
          );
        });

    for (const command of commands)
      it(`rejects an existing Video tombstone with legacy PUBLISHED status for ${command}`, async () => {
        const f = await fixture();
        await prisma.video.update({ where: { id: f.video.id }, data: { removedAt: new Date() } });
        const before = await facts(f);
        expect((await send(f, command)).statusCode).toBe(409);
        expect(await facts(f)).toEqual(before);
      });

    for (const command of commands)
      for (const existing of [true, false])
        it(`records the committed winner as prior state for concurrent ${command} (${existing ? "existing" : "absent"} row)`, async () => {
          const f = await fixture();
          const second = await actor("CONTENT_MODERATOR");
          if (!existing) {
            await prisma.videoPolicy.deleteMany({ where: { videoId: f.video.id } });
            await prisma.videoPolicyOverride.deleteMany({ where: { videoId: f.video.id } });
          }
          const entered = deferred(),
            release = deferred();
          const audit = app.get(AdminAuditLogService),
            original = audit.recordInTransaction.bind(audit);
          vi.spyOn(audit, "recordInTransaction").mockImplementationOnce(async (tx, input) => {
            const result = await original(tx, input);
            entered.resolve();
            await release.promise;
            return result;
          });
          const winnerCommand = command === "CLASSIFICATION" ? command : "OVERRIDE";
          const winner = send(f, winnerCommand, {
            ...(winnerCommand === "CLASSIFICATION"
              ? classification
              : { disposition: "FORCE_ALLOW", expiresAt: "2099-01-01T00:00:00.000Z" }),
            reason: "First concurrent policy review",
          });
          await entered.promise;
          const pending = send({ ...f, ...second }, command, {
            ...(command === "CLASSIFICATION"
              ? { maturityLevel: "MATURE", ageRestriction: "AGE_18_PLUS", kidsEligible: false }
              : command === "OVERRIDE"
                ? { disposition: "FORCE_BLOCK", expiresAt: null }
                : {}),
            reason: "Second concurrent policy review",
          });
          try {
            await observed("");
          } finally {
            release.resolve();
          }
          expect((await winner).statusCode).toBe(200);
          expect((await pending).statusCode).toBe(200);
          const audits = await prisma.adminAuditLog.findMany({
            where: { action: { startsWith: "video_policy." } },
          });
          expect(audits).toHaveLength(2);
          const after = audits.find((entry) => entry.reason === "Second concurrent policy review");
          expect(after?.metadata).toMatchObject(
            command === "CLASSIFICATION"
              ? {
                  previousMaturityLevel: "GENERAL",
                  previousAgeRestriction: "NONE",
                  previousKidsEligible: true,
                }
              : {
                  previousDisposition: "FORCE_ALLOW",
                  previousExpiresAt: "2099-01-01T00:00:00.000Z",
                },
          );
          const state = await facts(f);
          if (command === "CLASSIFICATION")
            expect(state.policy).toMatchObject({
              maturityLevel: "MATURE",
              ageRestriction: "AGE_18_PLUS",
              kidsEligible: false,
            });
          else if (command === "CLEAR") expect(state.override).toBeNull();
          else
            expect(state.override).toMatchObject({ disposition: "FORCE_BLOCK", expiresAt: null });
        });

    for (const route of ["STUDIO", "QUICK_UPLOAD"] as const)
      for (const existing of [true, false])
        it(`serializes actual ${route} metadata before classification (${existing ? "existing" : "absent"} policy), without deadlock or unrelated-field loss`, async () => {
          const f = await fixture();
          await prisma.channelMember.create({
            data: { channelId: f.video.channelId, accountId: f.id, role: "OWNER" },
          });
          if (!existing) await prisma.videoPolicy.delete({ where: { videoId: f.video.id } });
          await prisma.$executeRawUnsafe(
            `CREATE FUNCTION hold_creator_policy_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."maturityLevel" = 'MATURE' THEN PERFORM pg_advisory_xact_lock(1096379721, 1347374169); END IF; RETURN NEW; END; $$`,
          );
          await prisma.$executeRawUnsafe(
            'CREATE TRIGGER hold_creator_policy_write BEFORE INSERT OR UPDATE ON "VideoPolicy" FOR EACH ROW EXECUTE FUNCTION hold_creator_policy_write()',
          );
          const locked = deferred(),
            release = deferred();
          const holder = prisma.$transaction(
            async (tx) => {
              await tx.$executeRawUnsafe(
                "DO $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1347374169); END $$;",
              );
              locked.resolve();
              await release.promise;
            },
            { timeout: 15000 },
          );
          await locked.promise;
          const creator = Promise.resolve(
            app.inject({
              method: "PATCH",
              url:
                route === "STUDIO"
                  ? `/creator/studio/videos/${f.video.id}`
                  : `/creator/videos/${f.video.id}`,
              headers: { cookie: f.cookie },
              payload: {
                maturityLevel: "MATURE",
                ageRestriction: "AGE_18_PLUS",
                allowedTerritories: ["GB", "DE"],
                blockedTerritories: ["US"],
                rightsExpiresAt: "2099-01-01T00:00:00.000Z",
              },
            }),
          );
          let pending: ReturnType<typeof send> | undefined;
          try {
            await observed('"VideoPolicy"');
            pending = send(f, "CLASSIFICATION");
            await observed("ayin-admin-video-policy-target-lock");
          } finally {
            release.resolve();
            await holder;
            await creator;
            if (pending) await pending;
            await prisma.$executeRawUnsafe(
              'DROP TRIGGER IF EXISTS hold_creator_policy_write ON "VideoPolicy"',
            );
            await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS hold_creator_policy_write()");
          }
          expect((await creator).statusCode).toBe(200);
          expect((await pending!).statusCode).toBe(200);
          const state = await facts(f);
          expect(state.audits).toHaveLength(1);
          expect(state.audits[0]?.metadata).toMatchObject({
            previousMaturityLevel: "MATURE",
            previousAgeRestriction: "AGE_18_PLUS",
            previousKidsEligible: false,
          });
          expect(state.policy).toMatchObject({
            ...classification,
            allowedTerritories: ["GB", "DE"],
            blockedTerritories: ["US"],
            rightsExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
          });
          expect(state.override).toMatchObject({
            disposition: "FORCE_BLOCK",
            reason: "Original review restriction",
          });
        });

    for (const command of commands)
      it(`rolls back ${command} when actual audit insertion fails, then permits explicit retry`, async () => {
        const f = await fixture(),
          before = await facts(f);
        await prisma.$executeRawUnsafe(
          `CREATE FUNCTION reject_policy_authority_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'video_policy.%' THEN RAISE EXCEPTION 'controlled policy audit failure'; END IF; RETURN NEW; END; $$`,
        );
        await prisma.$executeRawUnsafe(
          'CREATE TRIGGER reject_policy_authority_audit BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION reject_policy_authority_audit()',
        );
        try {
          expect((await send(f, command)).statusCode).toBe(500);
          expect(await facts(f)).toEqual(before);
        } finally {
          await prisma.$executeRawUnsafe(
            'DROP TRIGGER IF EXISTS reject_policy_authority_audit ON "AdminAuditLog"',
          );
          await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_policy_authority_audit()");
        }
        expect((await send(f, command)).statusCode).toBe(200);
        expect((await facts(f)).audits).toHaveLength(before.audits.length + 1);
      });

    for (const role of ["OPERATIONS", "CONTENT_MODERATOR"] as const)
      it(`preserves ${role} writes without requiring privileged-role MFA and ordinary public policy reads`, async () => {
        const f = await fixture(role, false);
        for (const command of commands) expect((await send(f, command)).statusCode).toBe(200);
        const audits = (await facts(f)).audits;
        expect(audits).toHaveLength(3);
        const adminRead = await app.inject({
          method: "GET",
          url: `/admin/video-policies/${f.video.id}`,
          headers: { cookie: f.cookie },
        });
        expect(adminRead.statusCode).toBe(200);
        expect(adminRead.json()).toMatchObject({
          videoId: f.video.id,
          policy: classification,
          override: null,
        });
        const playback = await app.inject({
          method: "GET",
          url: `/public/videos/${f.video.slug}/playback`,
        });
        expect(playback.statusCode).toBe(200);
        expect(playback.json().video.id).toBe(f.video.id);
        const kids = await app.inject({ method: "GET", url: "/public/discovery/kids" });
        expect(kids.statusCode).toBe(200);
        expect(kids.body).toContain(f.video.id);
        expect((await facts(f)).audits).toEqual(audits);
      });

    for (const role of ["ADMIN", "SUPERADMIN"] as const)
      it(`preserves MFA-assured ${role} writes for all policy commands`, async () => {
        const f = await fixture(role);
        for (const command of commands) expect((await send(f, command)).statusCode).toBe(200);
        expect((await facts(f)).audits).toHaveLength(3);
      });

    for (const role of ["ADMIN", "SUPERADMIN", "FINANCE_MANAGER"] as const)
      it(`keeps existing ${role} authority requirements`, async () => {
        const f = await fixture(role, false),
          before = await facts(f);
        for (const command of commands)
          expect((await send(f, command)).statusCode).toBe(role === "FINANCE_MANAGER" ? 403 : 401);
        expect(await facts(f)).toEqual(before);
      });

    it("keeps strict GENERAL/NONE Kids validation with no policy or audit effects", async () => {
      const f = await fixture(),
        before = await facts(f);
      for (const patch of [
        { maturityLevel: "TEEN" },
        { maturityLevel: "MATURE" },
        { ageRestriction: "AGE_13_PLUS" },
        { ageRestriction: "AGE_18_PLUS" },
      ]) {
        expect(
          (
            await send(f, "CLASSIFICATION", {
              ...classification,
              ...patch,
              reason: "Invalid contradictory Kids review",
            })
          ).statusCode,
        ).toBe(400);
      }
      expect(await facts(f)).toEqual(before);
    });
  },
);
