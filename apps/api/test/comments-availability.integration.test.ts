import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Comments public availability and Kids server boundary", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  const previousToken = process.env.AYIN_INTERNAL_EDGE_TOKEN;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET =
      "comments-availability-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "comments-availability-upload-secret-with-more-than-32-characters";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.AYIN_INTERNAL_EDGE_TOKEN = "comments-test-edge-token";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });
  afterAll(async () => {
    if (previousToken === undefined) delete process.env.AYIN_INTERNAL_EDGE_TOKEN;
    else process.env.AYIN_INTERNAL_EDGE_TOKEN = previousToken;
    await app.close();
    await prisma.$disconnect();
  });
  async function fixture() {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Comments policy viewer",
        email: "comment-policy@example.test",
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user;
    const raw = response.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";", 1)[0] ?? "";
    const video = await prisma.video.create({
      data: {
        channelId: user.channel.id,
        title: "Policy video",
        slug: `policy-${randomUUID()}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        commentsEnabled: true,
        publishedAt: new Date(),
      },
    });
    const comment = await prisma.comment.create({
      data: { videoId: video.id, authorProfileId: user.profile.id, body: "Policy comment" },
    });
    return { user, video, comment, cookie };
  }
  it("uses trusted region for comment reads/writes and denies expired rights and removed channels", async () => {
    const f = await fixture();
    await prisma.videoPolicy.create({ data: { videoId: f.video.id, allowedTerritories: ["EG"] } });
    const url = `/comments/videos/${f.video.id}`;
    expect(
      (await app.inject({ method: "GET", url, headers: { "x-ayin-edge-country": "EG" } }))
        .statusCode,
    ).toBe(404);
    const headers = {
      cookie: f.cookie,
      "x-ayin-edge-country": "EG",
      "x-ayin-edge-token": "comments-test-edge-token",
    };
    const read = await app.inject({ method: "GET", url, headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().items).toHaveLength(1);
    expect(
      (await app.inject({ method: "POST", url, headers, payload: { body: "Allowed comment" } }))
        .statusCode,
    ).toBe(201);
    await prisma.videoPolicy.update({
      where: { videoId: f.video.id },
      data: { rightsExpiresAt: new Date(Date.now() - 1000) },
    });
    for (const request of [
      { method: "GET" as const, url },
      { method: "POST" as const, url, payload: { body: "Denied comment" } },
      { method: "PUT" as const, url: `/comments/${f.comment.id}/like`, payload: {} },
      {
        method: "POST" as const,
        url: `/comments/${f.comment.id}/report`,
        payload: { reason: "SPAM" },
      },
    ])
      expect((await app.inject({ ...request, headers })).statusCode).toBe(404);
    expect(await prisma.comment.count({ where: { videoId: f.video.id } })).toBe(2);
    expect(await prisma.reaction.count({ where: { commentId: f.comment.id } })).toBe(0);
    expect(await prisma.report.count({ where: { commentId: f.comment.id } })).toBe(0);
    await prisma.videoPolicy.update({
      where: { videoId: f.video.id },
      data: { rightsExpiresAt: null },
    });
    await prisma.channel.update({
      where: { id: f.video.channelId },
      data: { removedAt: new Date() },
    });
    expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(404);
  });
  it("blocks Kids profile comment/reaction/report writes without weakening owner cleanup", async () => {
    const f = await fixture();
    await prisma.viewerProfile.update({ where: { id: f.user.profile.id }, data: { isKids: true } });
    const headers = { cookie: f.cookie };
    for (const request of [
      {
        method: "POST" as const,
        url: `/comments/videos/${f.video.id}`,
        payload: { body: "Kids write", profileId: f.user.profile.id },
      },
      {
        method: "PUT" as const,
        url: `/comments/${f.comment.id}/like`,
        payload: { profileId: f.user.profile.id },
      },
      {
        method: "POST" as const,
        url: `/comments/${f.comment.id}/report`,
        payload: { reason: "SPAM", profileId: f.user.profile.id },
      },
    ])
      expect((await app.inject({ ...request, headers })).statusCode).toBe(403);
    expect(await prisma.comment.count({ where: { videoId: f.video.id } })).toBe(1);
    expect(await prisma.reaction.count({ where: { commentId: f.comment.id } })).toBe(0);
    expect(await prisma.report.count({ where: { commentId: f.comment.id } })).toBe(0);
    expect(
      (await app.inject({ method: "DELETE", url: `/comments/${f.comment.id}`, headers }))
        .statusCode,
    ).toBe(200);
  });
});
