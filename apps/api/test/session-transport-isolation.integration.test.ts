import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import {
  applyApiSecurityHeaders,
  isAllowedCookieMutationOrigin,
} from "../src/security/request-security.js";
import { enrollTestMfa } from "./mfa-test-helper.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const origin = "http://localhost:3000";
databaseDescribe("Actual explicit session transport isolation", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "session-transport-isolation-test-secret-more-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = origin;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
    // Same actual helpers/order as main.ts, before guards/controller processing.
    fastify.addHook("onRequest", async (request, reply) => {
      applyApiSecurityHeaders(reply, request);
      if (!isAllowedCookieMutationOrigin(request, origin))
        await reply
          .code(403)
          .send({
            error: {
              code: "CSRF_ORIGIN_REJECTED",
              message: "Controlled configured Origin boundary",
            },
          });
    });
    await app.init();
    await fastify.ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.adminAuditLog.deleteMany();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function register(bearer = false) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { origin, ...(bearer ? { "x-ayin-auth-transport": "bearer" } : {}) },
      payload: {
        name: "Actual transport identity",
        email: `transport-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const cookies = response.headers["set-cookie"];
    return {
      id: response.json().user.account.id as string,
      cookie: (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0],
      token: response.json().sessionToken as string | undefined,
    };
  }
  it("rejects invalid explicit authorization despite a valid MFA cookie and bypassed cookie-Origin branch with zero actual mutations", async () => {
    const actor = await register(),
      target = await register();
    if (!actor.cookie) throw Error("Expected cookie session");
    const { cookie } = await enrollTestMfa(app, actor.cookie, "strong-pass-123", origin);
    await prisma.adminRoleAssignment.create({ data: { accountId: actor.id, role: "OPERATIONS" } });
    const before = await prisma.account.findUniqueOrThrow({ where: { id: target.id } });
    const audits = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    const sessions = await prisma.accountSession.findMany({ orderBy: { id: "asc" } });
    for (const authorization of [
      "",
      "Bearer",
      "Bearer ",
      "Bearer   ",
      "Basic abc",
      "Bearer not-a-valid-token",
    ]) {
      const read = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie, authorization },
      });
      expect(read.statusCode).toBe(401);
      expect(read.headers["cache-control"]).toContain("no-store");
      const write = await app.inject({
        method: "PATCH",
        url: `/admin/control/users/${target.id}`,
        headers: { cookie, authorization, origin: "https://evil.example" },
        payload: { displayName: "Must never use cookie fallback" },
      });
      expect(write.statusCode).toBe(401);
      expect(write.body).not.toContain(before.email);
      expect(write.headers["cache-control"]).toContain("no-store");
    }
    expect(await prisma.account.findUniqueOrThrow({ where: { id: target.id } })).toEqual(before);
    expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(audits);
    expect(await prisma.accountSession.findMany({ orderBy: { id: "asc" } })).toEqual(sessions);
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).json().account.id,
    ).toBe(actor.id);
  });
  it("uses the actual explicit bearer account when another cookie exists and logs out only that bearer session", async () => {
    const a = await register(),
      b = await register(true);
    if (!a.cookie || !b.token) throw Error("Expected actual independent transports");
    for (const scheme of ["Bearer", "bearer", "BEARER"]) {
      const read = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { cookie: a.cookie, authorization: scheme + " " + b.token },
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().account.id).toBe(b.id);
      expect(read.json().account.id).not.toBe(a.id);
    }
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        cookie: a.cookie,
        authorization: "bearer " + b.token,
        origin: "https://evil.example",
      },
    });
    expect(logout.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: "Bearer " + b.token },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: a.cookie } })).json()
        .account.id,
    ).toBe(a.id);
    expect(
      await prisma.accountSession.count({ where: { accountId: a.id, revokedAt: { not: null } } }),
    ).toBe(0);
    expect(
      await prisma.accountSession.count({ where: { accountId: b.id, revokedAt: { not: null } } }),
    ).toBe(1);
  });
  it("returns unauthorized for malformed cookies and retains the real cookie-only mutation Origin guard", async () => {
    const actor = await register();
    if (!actor.cookie) throw Error("Expected actual cookie");
    for (const cookie of [
      "ayin_session=%",
      "ayin_session=%E0%A4%A",
      "ayin_session=; " + actor.cookie,
    ]) {
      const read = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
      expect(read.statusCode).toBe(401);
      expect(read.headers["cache-control"]).toContain("no-store");
    }
    const rejected = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: actor.cookie, origin: "https://evil.example" },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe("CSRF_ORIGIN_REJECTED");
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: actor.cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      await prisma.accountSession.count({
        where: { accountId: actor.id, revokedAt: { not: null } },
      }),
    ).toBe(0);
  });
});
