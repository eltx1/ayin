import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { AuthTokenService } from "../src/auth/auth-token.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const password = "strong-pass-123";

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

databaseDescribe("account session management", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-48-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register(email: string, userAgent = "Task48Browser/1.0") {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { "user-agent": userAgent },
      payload: { name: "Session Owner", email, password },
    });
    expect(response.statusCode).toBe(201);
    return {
      accountId: response.json().user.account.id as string,
      cookie: cookiePair(response.headers["set-cookie"]),
    };
  }

  async function bearerLogin(email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Safari/537.36",
        "x-ayin-auth-transport": "bearer",
      },
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return response.json().sessionToken as string;
  }

  it("identifies the current session without exposing a raw token or user agent", async () => {
    const owner = await register(
      "current-session@example.com",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18 Mobile Safari/604.1 private-id",
    );
    const response = await app.inject({
      method: "GET",
      url: "/auth/sessions",
      headers: { cookie: owner.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toHaveLength(1);
    expect(response.json().sessions[0]).toMatchObject({
      current: true,
      deviceLabel: "Safari on iPhone",
      status: "ACTIVE",
    });
    expect(JSON.stringify(response.json())).not.toContain("private-id");
    expect(JSON.stringify(response.json())).not.toContain("sessionToken");
  });

  it("refreshes last activity only after the bounded write interval", async () => {
    const owner = await register("last-activity@example.com");
    const stale = new Date(Date.now() - 10 * 60 * 1_000);
    await prisma.accountSession.updateMany({
      where: { accountId: owner.accountId },
      data: { lastActiveAt: stale },
    });
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(200);
    const refreshed = await prisma.accountSession.findFirstOrThrow({
      where: { accountId: owner.accountId },
      select: { lastActiveAt: true },
    });
    expect(refreshed.lastActiveAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("never allows an account to revoke another account's session", async () => {
    const first = await register("first-session-owner@example.com");
    const second = await register("second-session-owner@example.com");
    const target = await prisma.accountSession.findFirstOrThrow({
      where: { accountId: first.accountId },
      select: { id: true },
    });
    const attempt = await app.inject({
      method: "DELETE",
      url: `/auth/sessions/${target.id}`,
      headers: { cookie: second.cookie },
    });
    expect(attempt.statusCode).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: first.cookie } }))
        .statusCode,
    ).toBe(200);
  });

  it("rejects a revoked current token immediately and records revocation", async () => {
    const owner = await register("revoke-current@example.com");
    const session = await prisma.accountSession.findFirstOrThrow({
      where: { accountId: owner.accountId },
      select: { id: true },
    });
    const revoked = await app.inject({
      method: "DELETE",
      url: `/auth/sessions/${session.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ revoked: true, currentSessionRevoked: true });
    expect(revoked.headers["set-cookie"]).toContain("Max-Age=0");
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      await prisma.accountSession.findUnique({
        where: { id: session.id },
        select: { revokedAt: true },
      }),
    ).toMatchObject({ revokedAt: expect.any(Date) });
  });

  it("revokes all other sessions while retaining the authenticated current session", async () => {
    const owner = await register("revoke-others@example.com");
    const otherToken = await bearerLogin("revoke-others@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/auth/sessions/revoke-others",
      headers: { cookie: owner.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revoked: 1 });
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${otherToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("rejects an expired server-side session", async () => {
    const owner = await register("expired-session@example.com");
    await prisma.accountSession.updateMany({
      where: { accountId: owner.accountId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it("logout revokes only the presented session", async () => {
    const owner = await register("logout-one@example.com");
    const otherToken = await bearerLogin("logout-one@example.com");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/logout",
          headers: { authorization: `Bearer ${otherToken}` },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${otherToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("password change defaults to revoking other sessions and keeps the current one", async () => {
    const owner = await register("password-change@example.com");
    const otherToken = await bearerLogin("password-change@example.com");
    const changed = await app.inject({
      method: "POST",
      url: "/auth/password/change",
      headers: { cookie: owner.cookie },
      payload: { currentPassword: password, newPassword: "new-strong-pass-456" },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ changed: true, otherSessionsRevoked: 1 });
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${otherToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("password reset revokes every session", async () => {
    const owner = await register("password-reset-sessions@example.com");
    const otherToken = await bearerLogin("password-reset-sessions@example.com");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: owner.accountId } });
    const resetToken = moduleReference
      .get(AuthTokenService)
      .issuePasswordReset(owner.accountId, account.authVersion);
    const reset = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token: resetToken, password: "reset-strong-pass-789" },
    });
    expect(reset.statusCode).toBe(200);
    for (const headers of [{ cookie: owner.cookie }, { authorization: `Bearer ${otherToken}` }]) {
      expect((await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode).toBe(401);
    }
    expect(
      await prisma.accountSession.count({ where: { accountId: owner.accountId, revokedAt: null } }),
    ).toBe(0);
  });
});
