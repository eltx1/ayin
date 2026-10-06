import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { VideoMetadataService } from "../src/creator/video-metadata.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("bounded Studio content keyset", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  let metadata: VideoMetadataService;
  let owner: { accountId: string; channelId: string; cookie: string };
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "studio-pagination-isolated-test-secret-over-32-characters";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    metadata = module.get(VideoMetadataService);
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  async function register(email: string) {
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Studio pagination", email, password: "strong-pass-123" },
    });
    expect(result.statusCode).toBe(201);
    const cookies = result.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)!.split(";")[0]!;
    return {
      cookie,
      accountId: result.json().user.account.id as string,
      channelId: result.json().user.channel.id as string,
    };
  }
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
    owner = await register("studio-pagination@example.com");
    await prisma.video.createMany({
      data: Array.from({ length: 131 }, (_, i) => ({
        id: randomUUID(),
        channelId: owner.channelId,
        slug: `studio-page-${i}`,
        title: `${i % 2 ? "Film night" : "رحلة عالمية"} ${String(i).padStart(3, "0")}`,
        description: i % 3 === 0 ? "film night description" : null,
        status:
          i === 130 ? ("REMOVED" as const) : i % 2 ? ("PUBLISHED" as const) : ("DRAFT" as const),
        visibility: i % 3 === 0 ? ("PRIVATE" as const) : ("PUBLIC" as const),
        updatedAt: new Date(`2026-10-0${1 + Math.floor(i / 45)}T00:00:00.000Z`),
      })),
    });
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });
  async function page(query = "take=25", cookie = owner.cookie) {
    return app.inject({
      method: "GET",
      url: `/creator/studio/content?${query}`,
      headers: { cookie },
    });
  }
  it("traverses 130 visible rows with ties exactly once, hydrating returned rows only", async () => {
    const hydrate = vi.spyOn(metadata, "readMany");
    const expected = await prisma.video.findMany({
      where: { channelId: owner.channelId, status: { not: "REMOVED" } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await page(`take=25${cursor ? `&cursor=${cursor}` : ""}`);
      expect(result.statusCode).toBe(200);
      const data = result.json();
      expect(data.actorAccountId).toBe(owner.accountId);
      expect(data.page).toMatchObject({ take: 25, cursor });
      expect(data.videos.length).toBeLessThanOrEqual(25);
      expect(hydrate.mock.calls.at(-1)![0]).toEqual(
        data.videos.map((row: { id: string }) => row.id),
      );
      seen.push(...data.videos.map((row: { id: string }) => row.id));
      cursor = data.nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected.map((row) => row.id));
    expect(new Set(seen).size).toBe(130);
    expect(hydrate.mock.calls.map(([ids]) => ids.length)).toEqual([25, 25, 25, 25, 25, 5]);
  });
  it("applies query, status and visibility before pagination, including description matches", async () => {
    const expected = await prisma.video.findMany({
      where: {
        channelId: owner.channelId,
        status: "PUBLISHED",
        visibility: "PRIVATE",
        OR: [
          { title: { contains: "film night", mode: "insensitive" } },
          { description: { contains: "film night", mode: "insensitive" } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    let cursor: string | null = null;
    const seen: string[] = [];
    do {
      const result = await page(
        `take=7&query=film%20night&status=PUBLISHED&visibility=PRIVATE${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(result.statusCode).toBe(200);
      seen.push(...result.json().videos.map((row: { id: string }) => row.id));
      cursor = result.json().nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected.map((row) => row.id));
    const removed = await page("take=25&status=REMOVED");
    expect(removed.json().videos).toHaveLength(1);
  });
  it("uses the issued boundary after the anchor changes or disappears", async () => {
    const first = (await page()).json();
    const expectedSecond = (await page(`take=25&cursor=${first.nextCursor}`)).json();
    const anchor = first.videos.at(-1).id;
    await prisma.video.update({
      where: { id: anchor },
      data: { updatedAt: new Date("2026-10-05T20:00:00.000Z"), title: "Edited anchor" },
    });
    expect((await page(`take=25&cursor=${first.nextCursor}`)).json().videos).toEqual(
      expectedSecond.videos,
    );
    await prisma.video.delete({ where: { id: anchor } });
    expect((await page(`take=25&cursor=${first.nextCursor}`)).json().videos).toEqual(
      expectedSecond.videos,
    );
  });
  it("rejects wrong account/channel, changed filters/page size, malformed and versioned cursors", async () => {
    const first = (await page()).json();
    const other = await register("studio-other@example.com");
    expect((await page(`take=25&cursor=${first.nextCursor}`, other.cookie)).statusCode).toBe(400);
    for (const suffix of ["&query=changed", "&status=DRAFT", "&visibility=PRIVATE"])
      expect((await page(`take=25&cursor=${first.nextCursor}${suffix}`)).statusCode).toBe(400);
    expect((await page(`take=10&cursor=${first.nextCursor}`)).statusCode).toBe(400);
    for (const cursor of [
      "",
      "not-json",
      "a%2Bb",
      "a".repeat(2049),
      Buffer.from(JSON.stringify({ version: 999 })).toString("base64url"),
    ])
      expect((await page(`take=25&cursor=${cursor}`)).statusCode).toBe(400);
    const membership = await prisma.channelMember.findFirstOrThrow({
      where: { accountId: owner.accountId },
    });
    await prisma.channelMember.delete({ where: { id: membership.id } });
    expect((await page(`take=25&cursor=${first.nextCursor}`)).statusCode).toBe(404);
  });
  it("rejects a cursor when the same actor's resolved channel changes", async () => {
    const first = (await page()).json();
    const nextChannel = await prisma.channel.create({
      data: { handle: "replacement-channel", name: "Replacement channel" },
    });
    await prisma.channelMember.create({
      data: { channelId: nextChannel.id, accountId: owner.accountId, role: "EDITOR" },
    });
    await prisma.channelMember.deleteMany({
      where: { channelId: owner.channelId, accountId: owner.accountId },
    });
    expect((await page(`take=25&cursor=${first.nextCursor}`)).statusCode).toBe(400);
    expect((await page()).json().channel.id).toBe(nextChannel.id);
  });
  it.each(["OWNER", "ADMIN", "EDITOR"] as const)(
    "preserves current %s authorization and removed-channel rejection",
    async (role) => {
      await prisma.channelMember.updateMany({
        where: { accountId: owner.accountId },
        data: { role },
      });
      expect((await page()).statusCode).toBe(200);
      await prisma.channel.update({ where: { id: owner.channelId }, data: { status: "REMOVED" } });
      expect((await page()).statusCode).toBe(404);
    },
  );
  it("preserves the legacy 50-row channel/videos contract and 100-row maximum", async () => {
    expect((await page("status=PUBLISHED")).json().videos).toHaveLength(50);
    const maximum = await page("take=100");
    expect(maximum.json().videos).toHaveLength(100);
    expect(maximum.json().channel.id).toBe(owner.channelId);
    expect(maximum.json().nextCursor).toBeTypeOf("string");
    expect((await page("take=101")).statusCode).toBe(400);
    const anonymous = await app.inject({ method: "GET", url: "/creator/studio/content" });
    expect(anonymous.statusCode).toBe(401);
  });
});
