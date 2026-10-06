import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { Logger } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { AppModule } from "../src/app.module.js";
import { AuthTokenService } from "../src/auth/auth-token.service.js";
import { EMAIL_ADAPTER, type EmailAdapter } from "../src/auth/email.adapter.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("password recovery response privacy", () => {
  const prisma = createPrismaClient(testDatabaseUrl);
  const fixtureId = randomUUID();
  const activeId = randomUUID();
  const emails = {
    active: `reset-privacy-active-${fixtureId}@example.test`,
    suspended: `reset-privacy-suspended-${fixtureId}@example.test`,
    closed: `reset-privacy-closed-${fixtureId}@example.test`,
    unknown: `reset-privacy-unknown-${fixtureId}@example.test`,
  };
  const emailAdapter = {
    configured: true,
    sendPasswordReset: vi.fn<EmailAdapter["sendPasswordReset"]>(),
  };
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  let errorLog: MockInstance<Logger["error"]>;
  let issueToken: MockInstance<AuthTokenService["issuePasswordReset"]>;

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "password-recovery-privacy-test-secret-more-than-32";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";

    moduleReference = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    emailAdapter.configured = true;
    emailAdapter.sendPasswordReset.mockReset().mockResolvedValue(undefined);
    errorLog = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    issueToken = vi.spyOn(moduleReference.get(AuthTokenService), "issuePasswordReset");
    await prisma.account.createMany({
      data: [
        { id: activeId, email: emails.active, displayName: "Recovery active", authVersion: 7 },
        { email: emails.suspended, displayName: "Recovery suspended", status: "SUSPENDED" },
        { email: emails.closed, displayName: "Recovery closed", status: "CLOSED" },
      ],
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.account.deleteMany({ where: { email: { in: Object.values(emails) } } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function request(email: string, remoteAddress = "192.0.2.10") {
    return app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      remoteAddress,
      payload: { email },
    });
  }

  it("returns the same generic response for active, unknown and inactive accounts when delivery fails", async () => {
    emailAdapter.sendPasswordReset.mockImplementation(async (message) => {
      throw new Error(
        `Synthetic provider failure: ${activeId} ${message.email} ${message.resetUrl}`,
      );
    });

    const responses = [];
    for (const email of Object.values(emails)) {
      const response = await request(email);
      responses.push({ status: response.statusCode, body: response.body });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }

    expect(responses).toEqual(
      Object.values(emails).map(() => ({ status: 202, body: JSON.stringify({ accepted: true }) })),
    );
    expect(emailAdapter.sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(issueToken).toHaveBeenCalledExactlyOnceWith(activeId, 7);
    // The exact log allowlist excludes the recipient, account ID, reset token and provider error.
    expect(errorLog).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: "auth.password_reset.delivery_failed",
        code: "EMAIL_DELIVERY_FAILED",
      }),
    );
  });

  it("keeps unconfigured delivery generic without issuing tokens or attempting email", async () => {
    emailAdapter.configured = false;
    for (const email of Object.values(emails)) {
      const response = await request(email);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: true });
    }
    expect(issueToken).not.toHaveBeenCalled();
    expect(emailAdapter.sendPasswordReset).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("still sends a valid reset token to the normalized active account after successful delivery", async () => {
    const response = await request(emails.active.toUpperCase());
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
    expect(emailAdapter.sendPasswordReset).toHaveBeenCalledTimes(1);
    const message = emailAdapter.sendPasswordReset.mock.calls[0]?.[0];
    expect(message?.email).toBe(emails.active);
    const resetUrl = new URL(message!.resetUrl);
    expect(resetUrl.origin).toBe("http://localhost:3000");
    expect(resetUrl.pathname).toBe("/reset-password");
    expect(
      moduleReference
        .get(AuthTokenService)
        .verifyPasswordReset(resetUrl.searchParams.get("token")!),
    ).toMatchObject({ sub: activeId, av: 7, purpose: "password-reset" });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each([{}, { email: "not-an-email" }, { email: 123 }, { email: "" }])(
    "still rejects invalid recovery input %j before attempting delivery",
    async (payload) => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
      expect(issueToken).not.toHaveBeenCalled();
      expect(emailAdapter.sendPasswordReset).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it("still rate-limits known and unknown addresses before issuing tokens or attempting email", async () => {
    const remoteAddress = "192.0.2.20";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect((await request(emails.unknown, remoteAddress)).statusCode).toBe(202);
    }
    const responses = [];
    for (const email of Object.values(emails)) {
      const response = await request(email, remoteAddress);
      expect(response.statusCode).toBe(429);
      expect(response.json().error.code).toBe("RATE_LIMITED");
      responses.push(response.body);
    }
    expect(new Set(responses).size).toBe(1);
    expect(issueToken).not.toHaveBeenCalled();
    expect(emailAdapter.sendPasswordReset).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});
