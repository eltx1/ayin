import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { SessionService } from "../src/auth/session.service.js";
import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const origin = "http://localhost:3000",
  password = "strong-pass-123";
databaseDescribe("Actual expected-account request boundary", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "expected-account-scope-test-secret-more-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = origin;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.adminAuditLog.deleteMany();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });
  async function register() {
    const email = `scope-${randomUUID()}@example.com`;
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { origin },
      payload: { name: "Actual scoped account", email, password },
    });
    expect(response.statusCode).toBe(201);
    const raw = response.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";", 1)[0];
    if (!cookie) throw Error("Expected actual cookie session");
    return { id: response.json().user.account.id as string, cookie, email };
  }
  it("rejects switched-account private reads before their service calls", async () => {
    const a = await register(),
      b = await register();
    const sessions = vi.spyOn(app.get(SessionService), "list");
    const privacy = vi.spyOn(app.get(PrivacyLifecycleService), "status");
    const identity = vi.spyOn(app.get(AuthService), "getCurrentIdentity");
    for (const url of ["/auth/sessions", "/privacy/deletion", "/auth/me"]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: b.cookie, "x-ayin-expected-account": a.id },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("ACCOUNT_CHANGED");
      expect(response.body).not.toContain(b.email);
    }
    expect(sessions).not.toHaveBeenCalled();
    expect(privacy).not.toHaveBeenCalled();
    expect(identity).not.toHaveBeenCalled();
  });
  it("same-password account switch cannot change the other account password", async () => {
    const a = await register(),
      b = await register();
    const before = await prisma.account.findMany({ orderBy: { id: "asc" } });
    const change = vi.spyOn(app.get(AuthService), "changePassword");
    const response = await app.inject({
      method: "POST",
      url: "/auth/password/change",
      headers: { origin, cookie: b.cookie, "x-ayin-expected-account": a.id },
      payload: {
        currentPassword: password,
        newPassword: "never-written-password-456",
        revokeOtherSessions: true,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(change).not.toHaveBeenCalled();
    expect(await prisma.account.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
  it("rejects wrong-account deletion without creating requests or audits", async () => {
    const a = await register(),
      b = await register();
    const before = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    const change = vi.spyOn(app.get(PrivacyLifecycleService), "requestDeletion");
    const response = await app.inject({
      method: "POST",
      url: "/privacy/deletion",
      headers: { origin, cookie: b.cookie, "x-ayin-expected-account": a.id },
      payload: { password, confirmation: "DELETE MY AYIN ACCOUNT" },
    });
    expect(response.statusCode).toBe(409);
    expect(change).not.toHaveBeenCalled();
    expect(await prisma.accountDeletionRequest.count()).toBe(0);
    expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
  it("rejects wrong-account session revocation with all actual sessions intact", async () => {
    const a = await register(),
      b = await register();
    await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { origin },
      payload: { email: b.email, password },
    });
    const before = await prisma.accountSession.findMany({ orderBy: { id: "asc" } });
    const change = vi.spyOn(app.get(SessionService), "revokeOthers");
    const response = await app.inject({
      method: "POST",
      url: "/auth/sessions/revoke-others",
      headers: { origin, cookie: b.cookie, "x-ayin-expected-account": a.id },
    });
    expect(response.statusCode).toBe(409);
    expect(change).not.toHaveBeenCalled();
    expect(await prisma.accountSession.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
  it("malformed, repeated and padded scope rejects while actual uppercase and legacy callers work", async () => {
    const a = await register();
    for (const value of ["", "invalid", a.id + "," + a.id, " " + a.id, a.id + " "]) {
      const response = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { cookie: a.cookie, "x-ayin-expected-account": value },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("EXPECTED_ACCOUNT_INVALID");
    }
    for (const headers of [
      { cookie: a.cookie },
      { cookie: a.cookie, "x-ayin-expected-account": a.id.toUpperCase() },
    ])
      expect((await app.inject({ method: "GET", url: "/auth/sessions", headers })).statusCode).toBe(
        200,
      );
  });
  it("scope never changes explicit bearer priority or permits cookie fallback", async () => {
    const a = await register(),
      b = await register();
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { origin, "x-ayin-auth-transport": "bearer" },
      payload: { email: b.email, password },
    });
    expect(login.statusCode).toBe(200);
    const authorization = "Bearer " + login.json().sessionToken;
    const rejected = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: a.cookie, authorization, "x-ayin-expected-account": a.id },
    });
    expect(rejected.statusCode).toBe(409);
    const accepted = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: a.cookie, authorization, "x-ayin-expected-account": b.id },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().account.id).toBe(b.id);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: {
            cookie: a.cookie,
            authorization: "Basic invalid",
            "x-ayin-expected-account": a.id,
          },
        })
      ).statusCode,
    ).toBe(401);
  });
});
