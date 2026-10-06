import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AdvertisingControlService } from "../src/ads/advertising-control.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("Actual advertiser/campaign workspace contracts", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  const origin = "http://localhost:3000";
  const direct = {
    priority: 100,
    pricing: { model: "CPM", cpm: "1.25", fixedPrice: null },
    impressionGoal: 1000,
    frequencyCap: 3,
    pacing: "EVEN",
    targeting: { placementKeys: [] },
  };
  const commands = [
    "ADVERTISER_CREATED",
    "ADVERTISER_UPDATED",
    "ADVERTISER_DELETED",
    "CAMPAIGN_CREATED",
    "CAMPAIGN_UPDATED",
    "CAMPAIGN_DELETED",
  ] as const;
  type Command = (typeof commands)[number];
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "advertising-workspace-secret-longer-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = origin;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Advertiser", "AdPlacement" CASCADE');
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function actor(role: "ADMIN" | "AD_MANAGER" | "FINANCE_MANAGER" = "AD_MANAGER") {
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual advertiser operator",
        email: randomUUID() + "@example.test",
        password: "strong-pass-123",
      },
    });
    expect(registration.statusCode).toBe(201);
    const id = registration.json().user.account.id as string;
    const header = registration.headers["set-cookie"],
      raw = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
    if (!raw) throw Error("Expected session");
    const { cookie } = await enrollTestMfa(app, raw);
    await prisma.adminRoleAssignment.create({ data: { accountId: id, role } });
    return { id, cookie };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  async function fixture(role: "ADMIN" | "AD_MANAGER" | "FINANCE_MANAGER" = "AD_MANAGER") {
    const a = await actor(role);
    const advertiser = await prisma.advertiser.create({
      data: { name: "Actual empty advertiser" },
    });
    const parent = await prisma.advertiser.create({ data: { name: "Actual campaign parent" } });
    const campaign = await prisma.campaign.create({
      data: {
        advertiserId: parent.id,
        name: "Actual draft campaign",
        startsAt: new Date("2035-01-01T00:00:00Z"),
        endsAt: new Date("2035-01-20T00:00:00Z"),
      },
    });
    await prisma.directCampaignConfig.create({
      data: {
        campaignId: campaign.id,
        pricing: direct.pricing,
        targeting: direct.targeting,
        impressionGoal: 1000n,
      },
    });
    return { a, advertiser, parent, campaign };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function request(
    a: Actor,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    payload?: Record<string, unknown>,
  ) {
    return Promise.resolve(
      app.inject({
        method,
        url: "/admin/advertising/" + path,
        headers: { cookie: a.cookie, origin, "x-ayin-expected-account": a.id },
        ...(payload ? { payload } : {}),
      }),
    );
  }
  function send(f: Fixture, action: Command, mutationId = randomUUID()) {
    const campaign = action.startsWith("CAMPAIGN"),
      create = action.endsWith("CREATED"),
      remove = action.endsWith("DELETED");
    const target = campaign ? f.campaign : f.advertiser;
    return request(
      f.a,
      create ? "POST" : remove ? "DELETE" : "PATCH",
      (campaign ? "campaigns" : "advertisers") + (create ? "" : "/" + target.id),
      {
        mutationId,
        ...(create
          ? campaign
            ? {
                name: "Created actual campaign",
                advertiserId: f.parent.id,
                expectedAdvertiserUpdatedAt: f.parent.updatedAt.toISOString(),
                direct,
              }
            : { name: "Created actual advertiser" }
          : {
              expectedUpdatedAt: target.updatedAt.toISOString(),
              ...(remove ? {} : { name: "Changed actual record" }),
            }),
      },
    );
  }
  async function facts() {
    return {
      advertisers: await prisma.advertiser.findMany({ orderBy: { id: "asc" } }),
      campaigns: await prisma.campaign.findMany({ orderBy: { id: "asc" } }),
      configs: await prisma.directCampaignConfig.findMany({ orderBy: { id: "asc" } }),
      events: await prisma.adEvent.findMany({ orderBy: { id: "asc" } }),
      audits: await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } }),
    };
  }
  async function observed(marker: string) {
    await vi.waitFor(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{ count: bigint }>
        >(Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${"%" + marker + "%"}`);
        expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
      },
      { timeout: 4000, interval: 25 },
    );
  }
  async function hold(
    setup: (tx: Prisma.TransactionClient) => Promise<unknown>,
    finish?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      locked = new Promise<void>((r) => {
        acquired = r;
      });
    const done = prisma.$transaction(
      async (tx) => {
        await setup(tx);
        acquired();
        await gate;
        await finish?.(tx);
      },
      { timeout: 15000 },
    );
    await Promise.race([locked, done]);
    return { release, done };
  }

  it.each(commands)(
    "returns correlated %s with one atomic audit and actor-owned recovery",
    async (action) => {
      const f = await fixture(),
        mutationId = randomUUID(),
        before = await facts();
      const response = await send(f, action, mutationId);
      expect(response.statusCode).toBe(action.endsWith("CREATED") ? 201 : 200);
      const body = response.json();
      expect(body.acknowledgment).toMatchObject({
        mutationId,
        actorAccountId: f.a.id,
        action,
        entityType: action.startsWith("CAMPAIGN") ? "Campaign" : "Advertiser",
      });
      expect(body.acknowledgment.updatedAt).toBeTypeOf("string");
      if (action.endsWith("DELETED")) expect(body.record).toBeNull();
      else {
        expect(body.record.id).toBe(body.acknowledgment.entityId);
        expect(body.record.updatedAt).toBe(body.acknowledgment.updatedAt);
      }
      if (action === "CAMPAIGN_CREATED" || action === "CAMPAIGN_UPDATED") {
        expect(body.record.advertiser.name).toBe(f.parent.name);
        expect(body.record.direct.impressionGoal).toBe(1000);
      }
      expect((await facts()).audits).toHaveLength(before.audits.length + 1);
      const recovery = await request(f.a, "GET", "mutations/" + mutationId);
      expect(recovery.statusCode).toBe(200);
      expect(recovery.json()).toEqual({ acknowledgment: body.acknowledgment });
      expect(recovery.headers["cache-control"]).toBe("private, no-store");
      const other = await actor();
      expect((await request(other, "GET", "mutations/" + mutationId)).statusCode).toBe(404);
    },
  );

  it("rejects missing reviewed versions, preserves monotonic versions and rejects stale update/delete without effects", async () => {
    const f = await fixture();
    const future = new Date("2090-01-01T00:00:00Z");
    await prisma.advertiser.update({ where: { id: f.advertiser.id }, data: { updatedAt: future } });
    const first = await request(f.a, "PATCH", "advertisers/" + f.advertiser.id, {
      name: "New version",
      mutationId: randomUUID(),
      expectedUpdatedAt: future.toISOString(),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().record.updatedAt).toBe("2090-01-01T00:00:00.001Z");
    const before = await facts();
    for (const kind of ["advertisers", "campaigns"]) {
      const id = kind === "advertisers" ? f.advertiser.id : f.campaign.id;
      for (const method of ["PATCH", "DELETE"] as const) {
        expect(
          (await request(f.a, method, kind + "/" + id, { mutationId: randomUUID() })).statusCode,
        ).toBe(400);
        expect(
          (
            await request(f.a, method, kind + "/" + id, {
              mutationId: randomUUID(),
              expectedUpdatedAt: "2000-01-01T00:00:00Z",
            })
          ).statusCode,
        ).toBe(409);
      }
    }
    expect(
      (
        await request(f.a, "POST", "campaigns", {
          name: "Unreviewed",
          advertiserId: f.parent.id,
          direct,
          mutationId: randomUUID(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(f.a, "POST", "campaigns", {
          name: "Stale parent",
          advertiserId: f.parent.id,
          direct,
          mutationId: randomUUID(),
          expectedAdvertiserUpdatedAt: future.toISOString(),
        })
      ).statusCode,
    ).toBe(409);
    expect(await facts()).toEqual(before);
  });

  it("keeps absent patch fields unchanged, including stored status, exact money, dates and null currency", async () => {
    const f = await fixture();
    await prisma.advertiser.update({ where: { id: f.advertiser.id }, data: { status: "PAUSED" } });
    const ad = await request(f.a, "PATCH", "advertisers/" + f.advertiser.id, {
      name: "Only advertiser name",
    });
    expect(ad.statusCode).toBe(200);
    expect(ad.json().status).toBe("PAUSED");
    await prisma.campaign.update({
      where: { id: f.campaign.id },
      data: { status: "PAUSED", budget: "12345678901234.123456", currency: null },
    });
    const before = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
    const cfg = await prisma.directCampaignConfig.findUniqueOrThrow({
      where: { campaignId: f.campaign.id },
    });
    const result = await request(f.a, "PATCH", "campaigns/" + f.campaign.id, {
      name: "Only campaign name",
      mutationId: randomUUID(),
      expectedUpdatedAt: before.updatedAt.toISOString(),
    });
    expect(result.statusCode).toBe(200);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
    expect({ ...after, name: before.name, updatedAt: before.updatedAt }).toEqual(before);
    expect(after.budget?.toString()).toBe("12345678901234.123456");
    expect(
      await prisma.directCampaignConfig.findUniqueOrThrow({ where: { campaignId: f.campaign.id } }),
    ).toEqual(cfg);
  });

  it("allows only one of two same-version campaign updates, including direct-only writes", async () => {
    const f = await fixture(),
      other = await actor();
    const expectedUpdatedAt = f.campaign.updatedAt.toISOString();
    const results = await Promise.all([
      request(f.a, "PATCH", "campaigns/" + f.campaign.id, {
        mutationId: randomUUID(),
        expectedUpdatedAt,
        direct: { ...direct, priority: 101 },
      }),
      request(other, "PATCH", "campaigns/" + f.campaign.id, {
        mutationId: randomUUID(),
        expectedUpdatedAt,
        direct: { ...direct, priority: 102 },
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const current = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
    expect(current.updatedAt.getTime()).toBeGreaterThan(f.campaign.updatedAt.getTime());
    expect(await prisma.adminAuditLog.count({ where: { action: "CAMPAIGN_UPDATED" } })).toBe(1);
  });

  it("checks the combined legacy date range after an actual campaign-row wait", async () => {
    const f = await fixture();
    const holder = await hold(
      (tx) =>
        tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Campaign" WHERE "id"=${f.campaign.id}::uuid FOR UPDATE`,
        ),
      (tx) =>
        tx.campaign.update({
          where: { id: f.campaign.id },
          data: { startsAt: new Date("2035-01-15T00:00:00Z") },
        }),
    );
    const pending = request(f.a, "PATCH", "campaigns/" + f.campaign.id, {
      endsAt: "2035-01-10T00:00:00Z",
    });
    try {
      await observed("ayin-campaign-write-lock");
    } finally {
      holder.release();
    }
    await holder.done;
    const response = await pending;
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_CAMPAIGN_DATES");
    expect(await prisma.adminAuditLog.count({ where: { action: "CAMPAIGN_UPDATED" } })).toBe(0);
    expect(
      (await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } })).endsAt,
    ).toEqual(f.campaign.endsAt);
  });

  it("rejects advertiser deletion when campaign creation wins the parent lock", async () => {
    const f = await fixture();
    const holder = await hold(
      (tx) =>
        tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Advertiser" WHERE "id"=${f.advertiser.id}::uuid FOR UPDATE`,
        ),
      (tx) =>
        tx.campaign.create({
          data: { advertiserId: f.advertiser.id, name: "Actual competing child" },
        }),
    );
    const pending = send(f, "ADVERTISER_DELETED");
    try {
      await observed("ayin-advertiser-write-lock");
    } finally {
      holder.release();
    }
    await holder.done;
    const response = await pending;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ADVERTISER_HAS_CAMPAIGNS");
    expect(await prisma.advertiser.count({ where: { id: f.advertiser.id } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { action: "ADVERTISER_DELETED" } })).toBe(0);
  });

  it("rejects campaign creation when advertiser deletion wins its lock", async () => {
    const f = await fixture();
    const holder = await hold(
      (tx) =>
        tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Advertiser" WHERE "id"=${f.advertiser.id}::uuid FOR UPDATE`,
        ),
      (tx) => tx.advertiser.delete({ where: { id: f.advertiser.id } }),
    );
    const pending = request(f.a, "POST", "campaigns", {
      mutationId: randomUUID(),
      name: "Cannot create",
      advertiserId: f.advertiser.id,
      expectedAdvertiserUpdatedAt: f.advertiser.updatedAt.toISOString(),
      direct,
    });
    try {
      await observed("ayin-advertiser-write-lock");
    } finally {
      holder.release();
    }
    await holder.done;
    expect((await pending).statusCode).toBe(404);
    expect(await prisma.campaign.count({ where: { advertiserId: f.advertiser.id } })).toBe(0);
    expect(await prisma.adminAuditLog.count({ where: { action: "CAMPAIGN_CREATED" } })).toBe(0);
  });

  it("retains delivered campaign history when an actual event FK insert wins deletion", async () => {
    const f = await fixture();
    const placement = await prisma.adPlacement.create({
      data: {
        key: "actual-placement",
        name: "Actual placement",
        inventoryFamily: "OUTSIDE_PLAYER",
        format: "DISPLAY",
      },
    });
    const holder = await hold((tx) =>
      tx.adEvent.create({
        data: { placementId: placement.id, campaignId: f.campaign.id, eventType: "IMPRESSION" },
      }),
    );
    const pending = send(f, "CAMPAIGN_DELETED");
    try {
      await observed("ayin-campaign-write-lock");
    } finally {
      holder.release();
    }
    await holder.done;
    const response = await pending;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CAMPAIGN_NOT_DELETABLE");
    expect(await prisma.campaign.count({ where: { id: f.campaign.id } })).toBe(1);
    expect(await prisma.adEvent.count({ where: { campaignId: f.campaign.id } })).toBe(1);
  });

  it.each(commands)(
    "rolls back %s and correlation when actual audit insertion fails",
    async (action) => {
      const f = await fixture(),
        before = await facts(),
        mutationId = randomUUID();
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION reject_advertising_workspace_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'ADVERTISER_%' OR NEW.action LIKE 'CAMPAIGN_%' THEN RAISE EXCEPTION 'controlled workspace audit failure'; END IF; RETURN NEW; END; $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER reject_advertising_workspace_audit BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION reject_advertising_workspace_audit()',
      );
      try {
        expect((await send(f, action, mutationId)).statusCode).toBe(500);
        expect(await facts()).toEqual(before);
        expect((await request(f.a, "GET", "mutations/" + mutationId)).statusCode).toBe(404);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS reject_advertising_workspace_audit ON "AdminAuditLog"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS reject_advertising_workspace_audit()",
        );
      }
    },
  );

  for (const action of commands)
    for (const change of ["ROLE", "SESSION"] as const)
      it(`rejects ${action} after an observed authority wait and ${change} winner`, async () => {
        const f = await fixture("ADMIN"),
          before = await facts();
        const holder = await hold((tx) =>
          tx.$queryRaw(
            Prisma.sql`SELECT "accountId" FROM "AccountMfaCredential" WHERE "accountId"=${f.a.id}::uuid FOR UPDATE`,
          ),
        );
        const pending = send(f, action);
        try {
          await observed("ayin-admin-account-write-lock");
          if (change === "ROLE")
            await prisma.adminRoleAssignment.deleteMany({ where: { accountId: f.a.id } });
          else
            await prisma.accountSession.updateMany({
              where: { accountId: f.a.id },
              data: { revokedAt: new Date() },
            });
        } finally {
          holder.release();
        }
        await holder.done;
        expect((await pending).statusCode).toBe(change === "ROLE" ? 403 : 401);
        expect(await facts()).toEqual(before);
      });

  for (const change of ["ACCOUNT", "AUTHVERSION", "MFA"] as const)
    it(`rejects campaign update when actual ${change} authority wins`, async () => {
      const f = await fixture("ADMIN"),
        before = await facts();
      const holder = await hold(
        (tx) =>
          tx.$queryRaw(
            Prisma.sql`SELECT "accountId" FROM "AccountMfaCredential" WHERE "accountId"=${f.a.id}::uuid FOR UPDATE`,
          ),
        change === "MFA"
          ? (tx) =>
              tx.accountMfaCredential.update({
                where: { accountId: f.a.id },
                data: { version: { increment: 1 } },
              })
          : undefined,
      );
      const pending = send(f, "CAMPAIGN_UPDATED");
      try {
        await observed("ayin-admin-account-write-lock");
        if (change === "ACCOUNT")
          await prisma.account.update({ where: { id: f.a.id }, data: { status: "SUSPENDED" } });
        if (change === "AUTHVERSION")
          await prisma.account.update({
            where: { id: f.a.id },
            data: { authVersion: { increment: 1 } },
          });
      } finally {
        holder.release();
      }
      await holder.done;
      expect((await pending).statusCode).toBe(401);
      expect(await facts()).toEqual(before);
    });

  for (const action of commands.filter((c) => c !== "ADVERTISER_CREATED"))
    it(`rechecks expired step-up after ${action}'s target lock wait`, async () => {
      const f = await fixture(),
        before = await facts();
      const id = action.startsWith("ADVERTISER") ? f.advertiser.id : f.parent.id;
      const holder = await hold((tx) =>
        tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Advertiser" WHERE "id"=${id}::uuid FOR UPDATE`),
      );
      const pending = send(f, action);
      try {
        await observed("ayin-advertiser-write-lock");
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
      } finally {
        holder.release();
      }
      await holder.done;
      const response = await pending;
      vi.restoreAllMocks();
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("STEP_UP_REQUIRED");
      expect(await facts()).toEqual(before);
    });

  it("rechecks database-clock session expiry after the campaign target wait", async () => {
    const f = await fixture(),
      before = await facts();
    await prisma.accountSession.updateMany({
      where: { accountId: f.a.id, revokedAt: null },
      data: { expiresAt: new Date(Date.now() + 1500) },
    });
    const holder = await hold((tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Campaign" WHERE "id"=${f.campaign.id}::uuid FOR UPDATE`,
      ),
    );
    const pending = send(f, "CAMPAIGN_UPDATED");
    try {
      await observed("ayin-campaign-write-lock");
      await vi.waitFor(
        async () => {
          const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>(
            Prisma.sql`SELECT bool_and("expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) AS expired FROM "AccountSession" WHERE "accountId"=${f.a.id}::uuid AND "revokedAt" IS NULL`,
          );
          expect(row?.expired).toBe(true);
        },
        { timeout: 3000, interval: 25 },
      );
    } finally {
      holder.release();
    }
    await holder.done;
    expect((await pending).statusCode).toBe(401);
    expect(await facts()).toEqual(before);
  });

  it("returns one repeatable-read workspace and campaign/detail snapshot despite an intervening committed update", async () => {
    const f = await fixture();
    const database = app.get(DatabaseService);
    const original = database.client.$transaction.bind(database.client);
    for (const path of ["workspace", "campaigns", "campaigns/" + f.campaign.id]) {
      await prisma.$transaction(async (tx) => {
        await tx.advertiser.update({
          where: { id: f.parent.id },
          data: { name: "Before snapshot" },
        });
        await tx.campaign.update({
          where: { id: f.campaign.id },
          data: { name: "Before snapshot" },
        });
        await tx.directCampaignConfig.update({
          where: { campaignId: f.campaign.id },
          data: { priority: 100 },
        });
      });
      // Intercept only the boundary between two actual PostgreSQL reads. The
      // committed competing write uses a separate client/connection.
      const spy = vi.spyOn(database.client, "$transaction").mockImplementation((async (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: unknown,
      ) => {
        return original(
          async (tx) => {
            const find = tx.campaign.findMany.bind(tx.campaign);
            const findSpy = vi.spyOn(tx.campaign, "findMany").mockImplementation((async (
              ...args: Parameters<typeof find>
            ) => {
              const records = await find(...args);
              await prisma.$transaction(async (writer) => {
                await writer.advertiser.update({
                  where: { id: f.parent.id },
                  data: { name: "After snapshot" },
                });
                await writer.campaign.update({
                  where: { id: f.campaign.id },
                  data: { name: "After snapshot" },
                });
                await writer.directCampaignConfig.update({
                  where: { campaignId: f.campaign.id },
                  data: { priority: 900 },
                });
              });
              return records;
            }) as typeof tx.campaign.findMany);
            try {
              return await callback(tx);
            } finally {
              findSpy.mockRestore();
            }
          },
          options as { isolationLevel: Prisma.TransactionIsolationLevel },
        );
      }) as typeof database.client.$transaction);
      let response;
      try {
        response = await request(f.a, "GET", path);
      } finally {
        spy.mockRestore();
      }
      expect(response.statusCode).toBe(200);
      const record =
        path === "workspace"
          ? response.json().campaigns[0]
          : path === "campaigns"
            ? response.json()[0]
            : response.json();
      expect(record.name).toBe("Before snapshot");
      expect(record.advertiser.name).toBe("Before snapshot");
      expect(record.direct.priority).toBe(100);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("keeps legacy raw responses, denies Finance and account mismatch, and distinguishes missing/ambiguous commands", async () => {
    const f = await fixture(),
      service = app.get(AdvertisingControlService),
      read = vi.spyOn(service, "workspace");
    const finance = await actor("FINANCE_MANAGER");
    expect((await request(finance, "GET", "workspace")).statusCode).toBe(403);
    expect(read).not.toHaveBeenCalled();
    const switched = await app.inject({
      method: "GET",
      url: "/admin/advertising/workspace",
      headers: { cookie: f.a.cookie, "x-ayin-expected-account": finance.id },
    });
    expect(switched.statusCode).toBe(409);
    expect(switched.json().error.code).toBe("ACCOUNT_CHANGED");
    for (const action of commands)
      expect((await send({ ...f, a: finance }, action)).statusCode).toBe(403);
    expect(
      (await request(f.a, "PATCH", "advertisers/" + randomUUID(), { name: "Missing" })).statusCode,
    ).toBe(404);
    expect((await request(f.a, "GET", "campaigns/" + randomUUID())).statusCode).toBe(404);
    expect((await request(f.a, "GET", "advertisers/not-a-uuid")).statusCode).toBe(400);
    const raw = await request(f.a, "PATCH", "advertisers/" + f.advertiser.id, {
      name: "Legacy unchanged shape",
    });
    expect(raw.statusCode).toBe(200);
    expect(raw.json().id).toBe(f.advertiser.id);
    expect(raw.json()).not.toHaveProperty("acknowledgment");
    const id = randomUUID();
    expect((await send(f, "ADVERTISER_CREATED", id)).statusCode).toBe(201);
    expect((await send(f, "ADVERTISER_CREATED", id)).statusCode).toBe(201);
    expect((await request(f.a, "GET", "mutations/" + id)).statusCode).toBe(409);
  });
});
