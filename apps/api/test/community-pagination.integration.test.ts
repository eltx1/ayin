import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("Creator community bounded owned pagination", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "community-pagination-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "community-pagination-upload-secret-with-more-than-32-characters";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
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
  async function fixture() {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Creator",
        email: "community-page@example.test",
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user;
    const raw = response.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";", 1)[0] ?? "";
    const now = new Date("2026-01-01T12:00:00Z");
    await prisma.communityPost.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        id: randomUUID(),
        channelId: user.channel.id,
        authorAccountId: user.account.id,
        type: "TEXT",
        body: `Post ${i}`,
        status: i === 54 ? "REMOVED" : "DRAFT",
        createdAt: now,
      })),
    });
    return { user, headers: { cookie } };
  }
  it("traverses equal-timestamp pages without duplicates, removed items or unbounded reads", async () => {
    const { headers } = await fixture();
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await app.inject({
        method: "GET",
        url: `/creator/community/posts/page?take=20${cursor ? `&cursor=${cursor}` : ""}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      const page: { items: Array<{ id: string; status: string }>; nextCursor: string | null } =
        response.json();
      expect(page.items.length).toBeLessThanOrEqual(20);
      expect(page.items.every((post: { status: string }) => post.status !== "REMOVED")).toBe(true);
      ids.push(...page.items.map((post: { id: string }) => post.id));
      cursor = page.nextCursor;
      if (cursor) expect(cursor).toBe(page.items.at(-1)?.id);
    } while (cursor);
    expect(ids).toHaveLength(54);
    expect(new Set(ids).size).toBe(54);
  });
  it("rejects unauthenticated and invalid paging requests", async () => {
    const { headers } = await fixture();
    expect(
      (await app.inject({ method: "GET", url: "/creator/community/posts/page" })).statusCode,
    ).toBe(401);
    for (const query of ["take=0", "take=51", "take=1.5", "cursor=wrong"])
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/creator/community/posts/page?${query}`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
  });
  it("rejects foreign cursors and excludes posts owned by another channel", async () => {
    const { headers, user } = await fixture();
    const channel = await prisma.channel.create({
      data: { handle: `foreign-${randomUUID()}`, name: "Foreign", status: "ACTIVE" },
    });
    const foreign = await prisma.communityPost.create({
      data: {
        channelId: channel.id,
        authorAccountId: user.account.id,
        type: "TEXT",
        body: "Foreign",
        status: "DRAFT",
      },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/creator/community/posts/page?cursor=${foreign.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const own = (
      await app.inject({ method: "GET", url: "/creator/community/posts/page?take=50", headers })
    ).json();
    expect(own.items.some((post: { id: string }) => post.id === foreign.id)).toBe(false);
  });
});
