import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { TrustController } from "../src/trust/trust.controller.js";

describe("Report HTTP boundary validation (unit)", () => {
  it.each([
    { reason: "OTHER" },
    { channelId: randomUUID(), videoId: randomUUID(), reason: "OTHER" },
    { channelId: randomUUID(), reason: "OTHER", reporterProfileId: randomUUID() },
    { channelId: randomUUID(), reason: "OTHER", details: "a".repeat(4001) },
  ])("classifies malformed payload as a sanitized 400 before persistence", (payload) => {
    const report = vi.fn(),
      consume = vi.fn(),
      accountId = randomUUID();
    const controller = new TrustController({ report } as never, { consume } as never);
    let failure: unknown;
    try {
      controller.report({ ayinAuth: { accountId } } as never, payload);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(BadRequestException);
    expect((failure as BadRequestException).getStatus()).toBe(400);
    expect((failure as BadRequestException).getResponse()).toMatchObject({
      error: { code: "INVALID_REPORT" },
    });
    expect(JSON.stringify((failure as BadRequestException).getResponse())).not.toContain("aaaa");
    expect(report).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith(`report:${accountId}`, 10);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    !/(?:^|_)(?:test|e2e|proof)(?:_|$)/i.test(target.pathname.slice(1))
  )
    throw new Error("Report intake fixtures require an isolated loopback test database.");
}
const databaseDescribe = databaseUrl ? describe : describe.skip;

// Uses only the explicitly configured isolated integration database, never DATABASE_URL fallback.
databaseDescribe("Authenticated moderation report intake", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "trust-report-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "trust-report-test-upload-secret-with-more-than-32-characters";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });
  async function register(name: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name,
        email: `${name.toLowerCase()}@reports.example.test`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const cookieHeader = response.headers["set-cookie"];
    const cookie =
      (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)?.split(";", 1)[0] ?? "";
    const user = response.json().user as {
      account: { id: string };
      profile: { id: string };
      channel: { id: string };
    };
    return { user, headers: { cookie, "x-ayin-expected-account": user.account.id } };
  }
  it("persists video, comment and channel reports with server-owned reporter identity", async () => {
    const owner = await register("Owner"),
      viewer = await register("Viewer");
    const video = await prisma.video.create({
      data: {
        channelId: owner.user.channel.id,
        slug: `report-${randomUUID()}`,
        title: "Moderation fixture",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    });
    const comment = await prisma.comment.create({
      data: {
        videoId: video.id,
        authorProfileId: owner.user.profile.id,
        body: "Comment fixture",
      },
    });
    for (const target of [
      { videoId: video.id },
      { commentId: comment.id },
      { channelId: owner.user.channel.id },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/trust/reports",
        headers: viewer.headers,
        payload: { ...target, reason: "HARASSMENT", details: "Review this fixture" },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        ...target,
        reporterProfileId: viewer.user.profile.id,
      });
      expect(await prisma.report.findUnique({ where: { id: response.json().id } })).toMatchObject({
        ...target,
        reporterProfileId: viewer.user.profile.id,
        status: "OPEN",
        reason: "HARASSMENT",
      });
    }
    expect(await prisma.report.count()).toBe(3);
  });
  it("rejects unauthenticated, ambiguous, injected and changed-account reports without writes", async () => {
    const owner = await register("Owner"),
      viewer = await register("Viewer");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/trust/reports",
          payload: { channelId: owner.user.channel.id, reason: "OTHER" },
        })
      ).statusCode,
    ).toBe(401);
    for (const payload of [
      { reason: "OTHER" },
      { channelId: owner.user.channel.id, videoId: randomUUID(), reason: "OTHER" },
      {
        channelId: owner.user.channel.id,
        reason: "OTHER",
        reporterProfileId: owner.user.profile.id,
      },
      { channelId: owner.user.channel.id, reason: "OTHER", details: "a".repeat(4001) },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/trust/reports",
        headers: viewer.headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_REPORT" } });
    }
    const changed = await app.inject({
      method: "POST",
      url: "/trust/reports",
      headers: { ...viewer.headers, "x-ayin-expected-account": owner.user.account.id },
      payload: { channelId: owner.user.channel.id, reason: "OTHER" },
    });
    expect(changed.statusCode).toBe(409);
    expect(await prisma.report.count()).toBe(0);
  });
});
