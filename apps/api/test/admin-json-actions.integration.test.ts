import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { AuthTokenService } from "../src/auth/auth-token.service.js";
import { isAllowedCookieMutationOrigin } from "../src/security/request-security.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const origin = "http://localhost:3000";
const cases = ["advertiser", "campaign", "creative", "channel override", "video override"] as const;

databaseDescribe("Admin JSON action request regression", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  let tokens: AuthTokenService;
  const saved = {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
  };

  beforeAll(async () => {
    const db = new URL(databaseUrl!);
    if (
      !["localhost", "127.0.0.1", "postgres"].includes(db.hostname) ||
      !["/ayin_test", "/ayin_e2e"].includes(db.pathname)
    ) {
      throw new Error("Admin mutation fixtures require an isolated local AYIN test database.");
    }
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "admin-json-action-fixture-secret-over-32-characters";
    process.env.WEB_ORIGIN = origin;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    tokens = module.get(AuthTokenService);
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
    // AppModule fixtures do not execute main.ts. Install the same production
    // onRequest policy here; testing only Nest guards would miss the Origin gate.
    fastify.addHook("onRequest", async (request, reply) => {
      if (!isAllowedCookieMutationOrigin(request, origin)) {
        await reply.code(403).send({
          error: { code: "CSRF_ORIGIN_REJECTED", message: "Untrusted cookie mutation origin." },
        });
      }
    });
    await app.init();
    await fastify.ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Advertiser", "Campaign", "Creative", "VideoAdOverride" CASCADE',
    );
    await prisma.adminAuditLog.deleteMany();
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function operator() {
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "JSON action operator",
        email: "json-action@example.test",
        password: "strong-pass-123",
      },
    });
    expect(registration.statusCode).toBe(201);
    const rawCookie = registration.headers["set-cookie"];
    const cookie = (Array.isArray(rawCookie) ? rawCookie[0]! : rawCookie!).split(";", 1)[0]!;
    const { cookie: assuredCookie } = await enrollTestMfa(app, cookie, "strong-pass-123", origin);
    const user = registration.json().user;
    const role = await prisma.adminRoleAssignment.create({
      data: { accountId: user.account.id, role: "ADMIN" },
    });
    const payload = tokens.verifySession(
      decodeURIComponent(assuredCookie.split("=").slice(1).join("=")),
    )!;
    const expiresAt = new Date(payload.exp * 1000);
    const stale = tokens.issueSession(payload.sub, payload.av, payload.sid!, expiresAt, {
      mfaAt: payload.mfaAt!,
      mfaVersion: payload.mv!,
      reauthAt: Math.floor(Date.now() / 1000) - 3600,
    });
    const unassured = tokens.issueSession(payload.sub, payload.av, payload.sid!, expiresAt);
    return {
      cookie: assuredCookie,
      roleId: role.id,
      accountId: user.account.id as string,
      channelId: user.channel.id as string,
      staleCookie: `ayin_session=${encodeURIComponent(stale)}`,
      unassuredCookie: `ayin_session=${encodeURIComponent(unassured)}`,
    };
  }

  async function target(kind: (typeof cases)[number], channelId: string) {
    if (kind === "channel override" || kind === "video override") {
      const video =
        kind === "video override"
          ? await prisma.video.create({
              data: { channelId, title: "JSON action fixture", slug: "json-action-fixture" },
            })
          : null;
      const id = video?.id ?? channelId;
      const row = await prisma.videoAdOverride.create({
        data: { enabled: false, ...(video ? { videoId: id } : { channelId: id }) },
      });
      return {
        id,
        url: `/admin/video-ads/${video ? "videos" : "channels"}/${id}`,
        action: "VIDEO_AD_OVERRIDE_REMOVED",
        exists: async () => (await prisma.videoAdOverride.count({ where: { id: row.id } })) > 0,
      };
    }
    const advertiser = await prisma.advertiser.create({ data: { name: "Isolated fixture" } });
    if (kind === "advertiser")
      return {
        id: advertiser.id,
        url: `/admin/advertising/advertisers/${advertiser.id}`,
        action: "ADVERTISER_DELETED",
        exists: async () => (await prisma.advertiser.count({ where: { id: advertiser.id } })) > 0,
      };
    const campaign = await prisma.campaign.create({
      data: { advertiserId: advertiser.id, name: "Draft fixture" },
    });
    if (kind === "campaign")
      return {
        id: campaign.id,
        url: `/admin/advertising/campaigns/${campaign.id}`,
        action: "CAMPAIGN_DELETED",
        exists: async () => (await prisma.campaign.count({ where: { id: campaign.id } })) > 0,
      };
    const creative = await prisma.creative.create({
      data: { campaignId: campaign.id, name: "Draft creative", type: "DISPLAY" },
    });
    return {
      id: creative.id,
      url: `/admin/advertising/creatives/${creative.id}`,
      action: "CREATIVE_DELETED",
      exists: async () => (await prisma.creative.count({ where: { id: creative.id } })) > 0,
    };
  }

  it.each(cases)(
    "%s reaches the guarded action only with valid JSON and permission",
    async (kind) => {
      const actor = await operator();
      const resource = await target(kind, actor.channelId);
      const headers = { cookie: actor.cookie, origin, "content-type": "application/json" };
      const auditCount = () =>
        prisma.adminAuditLog.count({ where: { entityId: resource.id, action: resource.action } });

      // Reproduce the real pre-fix wire request. The parser must remain strict.
      const malformed = await app.inject({ method: "DELETE", url: resource.url, headers });
      expect(malformed.statusCode).toBe(400);
      expect(await resource.exists()).toBe(true);
      expect(await auditCount()).toBe(0);

      for (const [cookie, expected] of [
        ["", 401],
        [actor.unassuredCookie, 401],
        [actor.staleCookie, 403],
      ] as const) {
        const denied = await app.inject({
          method: "DELETE",
          url: resource.url,
          headers: { ...headers, cookie },
          payload: "{}",
        });
        expect(denied.statusCode).toBe(expected);
        if (cookie === actor.staleCookie) expect(denied.json().error.code).toBe("STEP_UP_REQUIRED");
        expect(await resource.exists()).toBe(true);
        expect(await auditCount()).toBe(0);
      }
      const foreign = await app.inject({
        method: "DELETE",
        url: resource.url,
        headers: { ...headers, origin: "https://foreign.example" },
        payload: "{}",
      });
      expect(foreign.statusCode).toBe(403);
      expect(foreign.json().error.code).toBe("CSRF_ORIGIN_REJECTED");
      expect(await resource.exists()).toBe(true);
      expect(await auditCount()).toBe(0);

      const originless = await app.inject({
        method: "DELETE",
        url: resource.url,
        headers: { cookie: actor.cookie, "content-type": "application/json" },
        payload: "{}",
      });
      expect(originless.statusCode).toBe(403);
      expect(originless.json().error.code).toBe("CSRF_ORIGIN_REJECTED");
      expect(await resource.exists()).toBe(true);
      expect(await auditCount()).toBe(0);

      await prisma.adminRoleAssignment.update({
        where: { id: actor.roleId },
        data: { role: "FINANCE_MANAGER" },
      });
      const wrongRole = await app.inject({
        method: "DELETE",
        url: resource.url,
        headers,
        payload: "{}",
      });
      expect(wrongRole.statusCode).toBe(403);
      expect(await resource.exists()).toBe(true);
      expect(await auditCount()).toBe(0);
      await prisma.adminRoleAssignment.update({
        where: { id: actor.roleId },
        data: { role: "AD_MANAGER" },
      });
      const success = await app.inject({
        method: "DELETE",
        url: resource.url,
        headers,
        payload: "{}",
      });
      expect(success.statusCode).toBe(200);
      expect(success.json()).toEqual({ deleted: true });
      expect(await resource.exists()).toBe(false);
      expect(await auditCount()).toBe(1);
      const audit = await prisma.adminAuditLog.findFirstOrThrow({
        where: { entityId: resource.id, action: resource.action },
      });
      expect(audit.actorAccountId).toBe(actor.accountId);
    },
  );
});
