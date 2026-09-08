import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { AuthTokenService } from "../src/auth/auth-token.service.js";
import { generateTotpCode, totpCounter } from "../src/auth/totp.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const password = "strong-pass-123";

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

databaseDescribe("Task 47 administrator MFA", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-47-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register(email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "MFA Administrator", email, password },
    });
    expect(response.statusCode).toBe(201);
    return {
      accountId: response.json().user.account.id as string,
      cookie: cookiePair(response.headers["set-cookie"]),
    };
  }

  async function beginEnrollmentFromLogin(email: string) {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toBeUndefined();
    expect(login.json()).toMatchObject({ mfaRequired: true, enrollmentRequired: true });
    const start = await app.inject({
      method: "POST",
      url: "/auth/mfa/enrollment/start",
      payload: { challengeToken: login.json().challengeToken },
    });
    expect(start.statusCode).toBe(201);
    return start.json() as {
      enrollmentToken: string;
      provisioningUri: string;
      qrCodeDataUrl: string;
      secret: string;
    };
  }

  async function enrollAuthenticated(account: { accountId: string; cookie: string }) {
    const start = await app.inject({
      method: "POST",
      url: "/auth/mfa/enrollment/start-authenticated",
      headers: { cookie: account.cookie },
      payload: { password },
    });
    expect(start.statusCode).toBe(201);
    const body = start.json() as { enrollmentToken: string; secret: string };
    const verification = await app.inject({
      method: "POST",
      url: "/auth/mfa/enrollment/verify",
      payload: {
        enrollmentToken: body.enrollmentToken,
        code: generateTotpCode(body.secret, totpCounter()),
      },
    });
    expect(verification.statusCode).toBe(200);
    return {
      cookie: cookiePair(verification.headers["set-cookie"]),
      recoveryCodes: verification.json().recoveryCodes as string[],
      secret: body.secret,
    };
  }

  it("requires enrollment after password login and never persists or re-exposes the secret", async () => {
    const account = await register("required-admin@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: account.accountId, role: "ADMIN" },
    });

    const blockedOldSession = await app.inject({
      method: "GET",
      url: "/admin/control/dashboard",
      headers: { cookie: account.cookie },
    });
    expect(blockedOldSession.statusCode).toBe(401);

    const enrollment = await beginEnrollmentFromLogin("required-admin@example.com");
    expect(enrollment.provisioningUri).toContain("otpauth://totp/");
    expect(enrollment.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    const storedPending = await prisma.accountMfaCredential.findUniqueOrThrow({
      where: { accountId: account.accountId },
    });
    expect(storedPending.encryptedSecret).not.toContain(enrollment.secret);
    expect(storedPending.recoveryCodeHashes).toEqual([]);

    const confirm = await app.inject({
      method: "POST",
      url: "/auth/mfa/enrollment/verify",
      payload: {
        enrollmentToken: enrollment.enrollmentToken,
        code: generateTotpCode(enrollment.secret, totpCounter()),
      },
    });
    expect(confirm.statusCode).toBe(200);
    const recoveryCodes = confirm.json().recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    const adminCookie = cookiePair(confirm.headers["set-cookie"]);

    const status = await app.inject({
      method: "GET",
      url: "/auth/mfa/status",
      headers: { cookie: adminCookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      enabled: true,
      required: true,
      recoveryCodesRemaining: 10,
    });
    expect(JSON.stringify(status.json())).not.toContain(enrollment.secret);

    const storedEnabled = await prisma.accountMfaCredential.findUniqueOrThrow({
      where: { accountId: account.accountId },
    });
    expect(storedEnabled.recoveryCodeHashes).toHaveLength(10);
    for (const code of recoveryCodes) {
      expect(storedEnabled.recoveryCodeHashes).not.toContain(code);
    }
    expect(
      await prisma.adminAuditLog.count({
        where: { actorAccountId: account.accountId, action: "auth.mfa_enabled" },
      }),
    ).toBe(1);

    const dashboard = await app.inject({
      method: "GET",
      url: "/admin/control/dashboard",
      headers: { cookie: adminCookie },
    });
    expect(dashboard.statusCode).toBe(200);

    const disable = await app.inject({
      method: "POST",
      url: "/auth/mfa/disable",
      headers: { cookie: adminCookie },
      payload: {
        password,
        code: generateTotpCode(enrollment.secret, totpCounter() + 1n),
      },
    });
    expect(disable.statusCode).toBe(409);
    expect(disable.json().error.code).toBe("MFA_REQUIRED_BY_POLICY");

    const beforeReset = await prisma.account.findUniqueOrThrow({
      where: { id: account.accountId },
    });
    const resetToken = moduleReference
      .get(AuthTokenService)
      .issuePasswordReset(account.accountId, beforeReset.authVersion);
    const passwordReset = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token: resetToken, password: "new-strong-pass-456" },
    });
    expect(passwordReset.statusCode).toBe(200);
    expect(
      await prisma.accountMfaCredential.findUnique({ where: { accountId: account.accountId } }),
    ).not.toBeNull();
    const loginAfterReset = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "required-admin@example.com", password: "new-strong-pass-456" },
    });
    expect(loginAfterReset.json()).toMatchObject({
      mfaRequired: true,
      enrollmentRequired: false,
    });
  });

  it("supports one-time recovery codes and rejects TOTP replay", async () => {
    const account = await register("challenge-admin@example.com");
    const enrolled = await enrollAuthenticated(account);
    await prisma.adminRoleAssignment.create({
      data: { accountId: account.accountId, role: "ADMIN" },
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "challenge-admin@example.com", password },
    });
    expect(login.json()).toMatchObject({ mfaRequired: true, enrollmentRequired: false });
    const nextCode = generateTotpCode(enrolled.secret, totpCounter() + 1n);
    const verified = await app.inject({
      method: "POST",
      url: "/auth/mfa/challenge",
      payload: { challengeToken: login.json().challengeToken, code: nextCode },
    });
    expect(verified.statusCode).toBe(200);

    const replayLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "challenge-admin@example.com", password },
    });
    const replay = await app.inject({
      method: "POST",
      url: "/auth/mfa/challenge",
      payload: { challengeToken: replayLogin.json().challengeToken, code: nextCode },
    });
    expect(replay.statusCode).toBe(401);

    const recoveryLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "challenge-admin@example.com", password },
    });
    const recovered = await app.inject({
      method: "POST",
      url: "/auth/mfa/challenge",
      payload: {
        challengeToken: recoveryLogin.json().challengeToken,
        recoveryCode: enrolled.recoveryCodes[0],
      },
    });
    expect(recovered.statusCode).toBe(200);
    expect(
      (
        await prisma.accountMfaCredential.findUniqueOrThrow({
          where: { accountId: account.accountId },
        })
      ).recoveryCodeHashes,
    ).toHaveLength(9);

    const reusedLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "challenge-admin@example.com", password },
    });
    const reused = await app.inject({
      method: "POST",
      url: "/auth/mfa/challenge",
      payload: {
        challengeToken: reusedLogin.json().challengeToken,
        recoveryCode: enrolled.recoveryCodes[0],
      },
    });
    expect(reused.statusCode).toBe(401);
  });

  it("keeps MFA optional for ordinary accounts and requires both factors to disable it", async () => {
    const account = await register("optional-user@example.com");
    const enrolled = await enrollAuthenticated(account);
    const disabled = await app.inject({
      method: "POST",
      url: "/auth/mfa/disable",
      headers: { cookie: enrolled.cookie },
      payload: {
        password,
        code: generateTotpCode(enrolled.secret, totpCounter() + 1n),
      },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toEqual({ disabled: true });
    expect(disabled.headers["set-cookie"]).toContain("Max-Age=0");
    expect(
      await prisma.accountMfaCredential.findUnique({ where: { accountId: account.accountId } }),
    ).toBeNull();
    expect(
      await prisma.adminAuditLog.count({
        where: { actorAccountId: account.accountId, action: "auth.mfa_disabled" },
      }),
    ).toBe(1);
  });

  it("allows only a stepped-up superadmin to reset another account and revokes sessions", async () => {
    const actor = await register("superadmin-actor@example.com");
    const target = await register("admin-target@example.com");
    const actorMfa = await enrollAuthenticated(actor);
    const targetMfa = await enrollAuthenticated(target);
    await prisma.adminRoleAssignment.createMany({
      data: [
        { accountId: actor.accountId, role: "SUPERADMIN" },
        { accountId: target.accountId, role: "ADMIN" },
      ],
    });

    const before = await prisma.account.findUniqueOrThrow({ where: { id: target.accountId } });
    const reset = await app.inject({
      method: "POST",
      url: `/admin/operations/staff/${target.accountId}/mfa/reset`,
      headers: { cookie: actorMfa.cookie },
      payload: { reason: "Verified administrator device replacement" },
    });
    expect(reset.statusCode).toBe(201);
    expect(reset.json()).toEqual({ reset: true, sessionsRevoked: true });
    expect(
      await prisma.accountMfaCredential.findUnique({ where: { accountId: target.accountId } }),
    ).toBeNull();
    const after = await prisma.account.findUniqueOrThrow({ where: { id: target.accountId } });
    expect(after.authVersion).toBe(before.authVersion + 1);

    const revoked = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: targetMfa.cookie },
    });
    expect(revoked.statusCode).toBe(401);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "admin.mfa_reset", entityId: target.accountId },
    });
    expect(audit?.actorAccountId).toBe(actor.accountId);
    expect(audit?.reason).toBe("Verified administrator device replacement");

    const selfReset = await app.inject({
      method: "POST",
      url: `/admin/operations/staff/${actor.accountId}/mfa/reset`,
      headers: { cookie: actorMfa.cookie },
      payload: { reason: "Self reset must not be allowed" },
    });
    expect(selfReset.statusCode).toBe(400);
    expect(selfReset.json().error.code).toBe("SELF_MFA_RESET_BLOCKED");
  });
});
