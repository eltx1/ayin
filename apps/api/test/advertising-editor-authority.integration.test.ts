import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { lockStaffRoleChanges } from "../src/database/staff-role-lock.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !["/ayin_test", "/ayin_e2e"].includes(url.pathname)
  )
    throw Error("Advertising authority proofs require isolated local ayin_test or ayin_e2e");
}
const commands = [
  "kill",
  "placement-create",
  "placement-update",
  "creative-create",
  "creative-update",
  "creative-delete",
  "creative-archive",
  "seller",
  "page",
] as const;
type Command = (typeof commands)[number];

// Reconstructed from the retained path inventory and current authority contract.
// These are fresh executable proofs, not recovered historical test source.
(databaseUrl ? describe : describe.skip)(
  "Advertising editor writes linearize with current authority",
  () => {
    const prisma = createPrismaClient(databaseUrl);
    let app: NestFastifyApplication;
    const origin = "http://localhost:3000";
    const pageSettings = {
      masterEnabled: false,
      googleGptEnabled: false,
      house: { imageUrl: null, clickUrl: null, altText: "Reviewed house label" },
    };
    beforeAll(async () => {
      process.env.APP_ENV = "test";
      process.env.AUTH_TOKEN_SECRET = "ad-editor-authority-local-secret-longer-than32";
      process.env.DATABASE_URL = databaseUrl;
      process.env.WEB_ORIGIN = origin;
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });
    beforeEach(async () => {
      vi.restoreAllMocks();
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "Account", "Advertiser", "AdPlacement", "PlatformSetting" CASCADE',
      );
      await prisma.adminAuditLog.deleteMany();
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });

    async function fixture(command: Command) {
      const registration = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Synthetic advertising operator",
          email: `ad-editor-${randomUUID()}@example.test`,
          password: "strong-pass-123",
        },
      });
      expect(registration.statusCode).toBe(201);
      const accountId = registration.json().user.account.id as string;
      const header = registration.headers["set-cookie"];
      const originalCookie = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
      if (!originalCookie) throw Error("Expected actual session");
      const { cookie } = await enrollTestMfa(app, originalCookie);
      await prisma.adminRoleAssignment.create({ data: { accountId, role: "ADMIN" } });
      const advertiser = await prisma.advertiser.create({ data: { name: "Synthetic advertiser" } });
      const campaign = await prisma.campaign.create({
        data: { advertiserId: advertiser.id, name: "Synthetic draft campaign" },
      });
      const creative = await prisma.creative.create({
        data: {
          campaignId: campaign.id,
          name: "Original creative",
          type: "DISPLAY",
          status: "DRAFT",
        },
      });
      await prisma.directCreativeConfig.create({ data: { creativeId: creative.id } });
      const placement = await prisma.adPlacement.create({
        data: {
          key: "original_placement",
          name: "Original placement",
          inventoryFamily: "OUTSIDE_PLAYER",
          format: "DISPLAY",
          enabled: false,
        },
      });
      if (command === "creative-archive") {
        await prisma.adEvent.create({
          data: {
            creativeId: creative.id,
            campaignId: campaign.id,
            placementId: placement.id,
            eventType: "IMPRESSION",
          },
        });
      }
      return { accountId, cookie, campaign, creative, placement };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;

    function send(f: Fixture, command: Command) {
      const base = "/admin/advertising/";
      const creativeInput = {
        campaignId: f.campaign.id,
        name: "Created creative",
        type: "DISPLAY",
        status: "DRAFT",
        direct: {},
      };
      const placementInput = {
        key: "created_placement",
        name: "Created placement",
        inventoryFamily: "OUTSIDE_PLAYER",
        format: "DISPLAY",
        enabled: false,
      };
      const routes: Record<
        Command,
        { method: "POST" | "PATCH" | "DELETE" | "PUT"; url: string; payload?: object }
      > = {
        kill: {
          method: "PATCH",
          url: base + "kill-switch",
          payload: { enabled: true, reason: "Synthetic reviewed emergency stop" },
        },
        "placement-create": { method: "POST", url: base + "placements", payload: placementInput },
        "placement-update": {
          method: "PATCH",
          url: base + "placements/" + f.placement.id,
          payload: { name: "Changed placement" },
        },
        "creative-create": { method: "POST", url: base + "creatives", payload: creativeInput },
        "creative-update": {
          method: "PATCH",
          url: base + "creatives/" + f.creative.id,
          payload: { name: "Changed creative", direct: { approvedReference: "Reviewed metadata" } },
        },
        "creative-delete": { method: "DELETE", url: base + "creatives/" + f.creative.id },
        "creative-archive": { method: "DELETE", url: base + "creatives/" + f.creative.id },
        seller: {
          method: "PUT",
          url: base + "authorized-sellers/ads",
          payload: {
            text: "# Reviewed synthetic seller content",
            reason: "Synthetic seller publication review",
          },
        },
        page: { method: "PATCH", url: "/admin/page-ads/settings", payload: pageSettings },
      };
      return Promise.resolve(
        app.inject({
          ...routes[command],
          headers: { cookie: f.cookie, origin, "x-ayin-expected-account": f.accountId },
        }),
      );
    }

    async function facts() {
      return {
        placements: await prisma.adPlacement.findMany({ orderBy: { id: "asc" } }),
        creatives: await prisma.creative.findMany({ orderBy: { id: "asc" } }),
        configs: await prisma.directCreativeConfig.findMany({ orderBy: { id: "asc" } }),
        settings: await prisma.platformSetting.findMany({ orderBy: { id: "asc" } }),
        events: await prisma.adEvent.findMany({ orderBy: { id: "asc" } }),
        audits: await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } }),
      };
    }

    async function hold(
      setup: (tx: Prisma.TransactionClient) => Promise<unknown>,
      finish?: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) {
      let release!: () => void;
      let acquired!: (pid: number) => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<number>((resolve) => {
        acquired = resolve;
      });
      const done = prisma.$transaction(
        async (tx) => {
          await setup(tx);
          const [backend] = await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          acquired(backend!.pid);
          await gate;
          await finish?.(tx);
        },
        { timeout: 15000 },
      );
      const pid = await Promise.race([
        locked,
        done.then(() => {
          throw Error("Lock holder ended before acquisition");
        }),
      ]);
      return { pid, release, done };
    }

    async function observedWait(blockerPid: number) {
      let blockedPid = 0;
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ pid: number }>>(Prisma.sql`
        SELECT pid FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND ${blockerPid} = ANY(pg_blocking_pids(pid))`);
          expect(rows).toHaveLength(1);
          blockedPid = rows[0]!.pid;
        },
        { timeout: 4000, interval: 25 },
      );
      return blockedPid;
    }

    async function expectCommitted(
      f: Fixture,
      command: Command,
      before: Awaited<ReturnType<typeof facts>>,
    ) {
      const after = await facts();
      const actions: Record<Exclude<Command, "page">, string> = {
        kill: "AD_EMERGENCY_KILL_SWITCH_UPDATED",
        "placement-create": "AD_PLACEMENT_CREATED",
        "placement-update": "AD_PLACEMENT_UPDATED",
        "creative-create": "CREATIVE_CREATED",
        "creative-update": "CREATIVE_UPDATED",
        "creative-delete": "CREATIVE_DELETED",
        "creative-archive": "CREATIVE_ARCHIVED",
        seller: "AUTHORIZED_SELLER_FILE_UPDATED",
      };
      if (command === "page") expect(after.audits).toEqual(before.audits);
      else {
        expect(after.audits).toHaveLength(before.audits.length + 1);
        expect(
          after.audits.filter((row) => !before.audits.some((prior) => prior.id === row.id)),
        ).toEqual([
          expect.objectContaining({ actorAccountId: f.accountId, action: actions[command] }),
        ]);
      }
      if (command === "kill")
        expect(after.settings).toContainEqual(
          expect.objectContaining({ key: "emergencyKillSwitch", value: true }),
        );
      if (command === "placement-create")
        expect(after.placements).toContainEqual(
          expect.objectContaining({ key: "created_placement", enabled: false }),
        );
      if (command === "placement-update")
        expect(after.placements).toContainEqual(
          expect.objectContaining({ id: f.placement.id, name: "Changed placement" }),
        );
      if (command === "creative-create") {
        const created = after.creatives.find((row) => row.name === "Created creative");
        expect(created).toMatchObject({ campaignId: f.campaign.id, status: "DRAFT" });
        expect(after.configs).toContainEqual(expect.objectContaining({ creativeId: created?.id }));
      }
      if (command === "creative-update") {
        expect(after.creatives).toContainEqual(
          expect.objectContaining({ id: f.creative.id, name: "Changed creative" }),
        );
        expect(after.configs).toContainEqual(
          expect.objectContaining({
            creativeId: f.creative.id,
            approvedReference: "Reviewed metadata",
          }),
        );
      }
      if (command === "creative-delete") {
        expect(after.creatives).toEqual([]);
        expect(after.configs).toEqual([]);
      }
      if (command === "creative-archive") {
        expect(after.creatives).toContainEqual(
          expect.objectContaining({ id: f.creative.id, status: "ARCHIVED" }),
        );
        expect(after.configs).toEqual(before.configs);
      }
      if (command === "seller")
        expect(after.settings).toContainEqual(
          expect.objectContaining({
            key: "adsTxtManualContent",
            value: "# Reviewed synthetic seller content",
          }),
        );
      if (command === "page")
        expect(after.settings).toContainEqual(
          expect.objectContaining({ key: "pageAdsV1", value: pageSettings }),
        );
      expect(after.events).toEqual(before.events);
      return after;
    }

    it.each(commands)(
      "rejects %s after a revocation wins the actual authority lock",
      async (command) => {
        const f = await fixture(command);
        const before = await facts();
        const revocation = await hold(lockStaffRoleChanges, (tx) =>
          tx.adminRoleAssignment.deleteMany({ where: { accountId: f.accountId } }),
        );
        const pending = send(f, command);
        try {
          await observedWait(revocation.pid);
        } finally {
          revocation.release();
        }
        await revocation.done;
        const response = await pending;
        expect(response.statusCode).toBe(403);
        expect(await facts()).toEqual(before);
      },
    );

    for (const expiry of ["step-up", "session"] as const)
      it.each(commands.filter((command) => command !== "page"))(
        `rolls back %s and its audit when ${expiry} expires during the audit insert`,
        async (command) => {
          const f = await fixture(command);
          const before = await facts();
          await prisma.$executeRawUnsafe(
            "CREATE FUNCTION ayin_test_hold_ad_editor_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1398034100); RETURN NEW; END $$",
          );
          await prisma.$executeRawUnsafe(
            'CREATE TRIGGER ayin_test_ad_editor_audit BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_hold_ad_editor_audit()',
          );
          const gate = await hold((tx) =>
            tx.$executeRawUnsafe(
              "DO $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1398034100); END $$;",
            ),
          );
          if (expiry === "session")
            await prisma.$executeRaw(Prisma.sql`
              UPDATE "AccountSession"
              SET "expiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '2 seconds'
              WHERE "accountId" = ${f.accountId}::uuid AND "revokedAt" IS NULL`);
          const pending = send(f, command);
          try {
            // The actual audit INSERT is blocked after the domain changes and
            // pre-audit authority check. Expiry must still roll everything back.
            await observedWait(gate.pid);
            if (expiry === "step-up") {
              vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
            } else {
              await vi.waitFor(
                async () => {
                  const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>(Prisma.sql`
                  SELECT bool_and("expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) AS expired
                  FROM "AccountSession" WHERE "accountId" = ${f.accountId}::uuid
                  AND "revokedAt" IS NULL`);
                  expect(row?.expired).toBe(true);
                },
                { timeout: 3500, interval: 25 },
              );
            }
          } finally {
            gate.release();
            await gate.done;
            await Promise.allSettled([pending]);
            vi.restoreAllMocks();
            await prisma.$executeRawUnsafe(
              'DROP TRIGGER ayin_test_ad_editor_audit ON "AdminAuditLog"',
            );
            await prisma.$executeRawUnsafe("DROP FUNCTION ayin_test_hold_ad_editor_audit()");
          }
          const response = await pending;
          expect(response.statusCode).toBe(expiry === "session" ? 401 : 403);
          expect(response.json().error.code).toBe(
            expiry === "session" ? "UNAUTHORIZED" : "STEP_UP_REQUIRED",
          );
          expect(await facts()).toEqual(before);
        },
      );

    it.each(commands)(
      "commits %s and its existing audit before a later revocation",
      async (command) => {
        const f = await fixture(command);
        const before = await facts();
        const table = command.startsWith("placement")
          ? "AdPlacement"
          : command.startsWith("creative")
            ? "Creative"
            : "PlatformSetting";
        await prisma.$executeRawUnsafe(
          `CREATE FUNCTION ayin_test_hold_ad_editor_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1398034099); IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$`,
        );
        await prisma.$executeRawUnsafe(
          `CREATE TRIGGER ayin_test_ad_editor_write BEFORE INSERT OR UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION ayin_test_hold_ad_editor_write()`,
        );
        const gate = await hold((tx) =>
          tx.$executeRawUnsafe(
            "DO $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1398034099); END $$;",
          ),
        );
        const pending = send(f, command);
        let revocation: Promise<unknown> | undefined;
        try {
          // The mutation is in its real SQL trigger, after owning write authority.
          const writerPid = await observedWait(gate.pid);
          revocation = prisma.$transaction(
            async (tx) => {
              await lockStaffRoleChanges(tx);
              return tx.adminRoleAssignment.deleteMany({ where: { accountId: f.accountId } });
            },
            { timeout: 15000 },
          );
          await observedWait(writerPid);
        } finally {
          gate.release();
          await gate.done;
          await Promise.allSettled([pending, ...(revocation ? [revocation] : [])]);
          await prisma.$executeRawUnsafe(`DROP TRIGGER ayin_test_ad_editor_write ON "${table}"`);
          await prisma.$executeRawUnsafe("DROP FUNCTION ayin_test_hold_ad_editor_write()");
        }
        const response = await pending;
        expect(response.statusCode).toBe(command.endsWith("create") ? 201 : 200);
        await revocation;
        const committed = await expectCommitted(f, command, before);
        expect((await send(f, command)).statusCode).toBe(403);
        expect(await facts()).toEqual(committed);
      },
    );
  },
);
