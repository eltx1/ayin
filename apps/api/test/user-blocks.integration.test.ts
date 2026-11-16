import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("Account-wide user blocking", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "user-block-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "user-block-test-upload-secret-with-more-than-32-characters";
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
        email: `${name.toLowerCase()}@blocks.example.test`,
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
      channel: { id: string; handle: string };
    };
    return { user, headers: { cookie, "x-ayin-expected-account": user.account.id } };
  }
  async function fixture() {
    const owner = await register("Owner");
    const viewer = await register("Viewer");
    const third = await register("Third");
    const video = await prisma.video.create({
      data: {
        channelId: third.user.channel.id,
        slug: `block-${randomUUID()}`,
        title: "Block test",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        commentsEnabled: true,
        publishedAt: new Date(),
      },
    });
    return { owner, viewer, third, video };
  }

  it("requires current identity, validates targets, rejects self-block, and keeps unblock ownership", async () => {
    const { owner, viewer, third } = await fixture();
    expect((await app.inject({ method: "GET", url: "/user-blocks" })).statusCode).toBe(401);
    for (const payload of [
      {},
      { accountId: owner.user.account.id },
      { profileId: owner.user.profile.id, channelId: owner.user.channel.id },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/user-blocks",
            headers: viewer.headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/user-blocks",
          headers: viewer.headers,
          payload: { profileId: viewer.user.profile.id },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/user-blocks",
          headers: { ...viewer.headers, "x-ayin-expected-account": third.user.account.id },
          payload: { channelId: owner.user.channel.id },
        })
      ).statusCode,
    ).toBe(409);
    for (let attempt = 0; attempt < 2; attempt++) {
      const blocked = await app.inject({
        method: "POST",
        url: "/user-blocks",
        headers: viewer.headers,
        payload: { channelId: owner.user.channel.id },
      });
      expect(blocked.statusCode).toBe(201);
      expect(blocked.json()).toMatchObject({
        accountId: viewer.user.account.id,
        blocked: true,
        blockedAccountIds: [owner.user.account.id],
      });
    }
    expect(await prisma.userBlock.count()).toBe(1);
    const unrelatedChannel = await prisma.channel.create({
      data: {
        handle: `unrelated-${randomUUID()}`,
        name: "Do not reveal linked ownership",
        members: { create: { accountId: owner.user.account.id, role: "OWNER" } },
      },
    });
    const list = await app.inject({ method: "GET", url: "/user-blocks", headers: viewer.headers });
    expect(list.headers["cache-control"]).toContain("no-store");
    expect(list.json().items[0]).toMatchObject({ blockedAccountId: owner.user.account.id });
    expect(JSON.stringify(list.json())).not.toContain("@blocks.example.test");
    expect(JSON.stringify(list.json())).not.toContain(unrelatedChannel.id);
    await app.inject({
      method: "DELETE",
      url: `/user-blocks/${owner.user.account.id}`,
      headers: third.headers,
    });
    expect(await prisma.userBlock.count()).toBe(1);
    await app.inject({
      method: "DELETE",
      url: `/user-blocks/${owner.user.account.id}`,
      headers: viewer.headers,
    });
    expect(await prisma.userBlock.count()).toBe(0);
  });

  it("offers a metadata-free account-wide safety lookup for Kids without social features", async () => {
    const { owner, viewer, third } = await fixture();
    await prisma.viewerProfile.update({
      where: { id: viewer.user.profile.id },
      data: { isKids: true },
    });
    const alternate = await prisma.channel.create({
      data: {
        handle: `alternate-${randomUUID()}`,
        name: "Private ownership linkage",
        members: { create: { accountId: owner.user.account.id, role: "OWNER" } },
      },
    });
    const url = `/user-blocks/channels/${alternate.id}`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/user-blocks/channels/invalid",
          headers: viewer.headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url,
          headers: { ...viewer.headers, "x-ayin-expected-account": third.user.account.id },
        })
      ).statusCode,
    ).toBe(409);
    const unblocked = await app.inject({ method: "GET", url, headers: viewer.headers });
    expect(unblocked.statusCode).toBe(200);
    expect(unblocked.headers["cache-control"]).toContain("no-store");
    expect(unblocked.json()).toEqual({
      accountId: viewer.user.account.id,
      channelId: alternate.id,
      blocked: false,
    });
    // A block of one public channel applies to all channels owned by the account.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/user-blocks",
          headers: viewer.headers,
          payload: { channelId: owner.user.channel.id },
        })
      ).statusCode,
    ).toBe(201);
    expect((await app.inject({ method: "GET", url, headers: viewer.headers })).json()).toEqual({
      accountId: viewer.user.account.id,
      channelId: alternate.id,
      blocked: true,
    });
    // The reverse relation is checked without exposing either account's identity.
    const reverse = await app.inject({
      method: "GET",
      url: `/user-blocks/channels/${viewer.user.channel.id}`,
      headers: owner.headers,
    });
    expect(reverse.json()).toEqual({
      accountId: owner.user.account.id,
      channelId: viewer.user.channel.id,
      blocked: true,
    });
    const absentId = randomUUID();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/user-blocks/channels/${absentId}`,
          headers: viewer.headers,
        })
      ).json(),
    ).toEqual({
      accountId: viewer.user.account.id,
      channelId: absentId,
      blocked: false,
    });
  });

  it("removes subscriptions and suppresses blocked notifications without resubscribing on unblock", async () => {
    const { owner, viewer } = await fixture();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/social/channels/${owner.user.channel.id}/subscription`,
          headers: viewer.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(await prisma.subscription.count()).toBe(1);
    await prisma.notification.create({
      data: {
        accountId: viewer.user.account.id,
        type: "CHANNEL",
        title: "A post",
        body: "A post",
        data: { channelId: owner.user.channel.id },
      },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/user-blocks",
          headers: viewer.headers,
          payload: { channelId: owner.user.channel.id },
        })
      ).statusCode,
    ).toBe(201);
    expect(await prisma.subscription.count()).toBe(0);
    expect(
      await prisma.analyticsSubscriptionEpisode.count({ where: { unsubscribedAt: null } }),
    ).toBe(0);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/social/channels/${owner.user.channel.id}/subscription`,
          headers: viewer.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({ method: "GET", url: "/social/notifications", headers: viewer.headers })
      ).json().items,
    ).toEqual([]);
    // Bidirectional means the blocked account cannot establish the reverse relationship.
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/social/channels/${viewer.user.channel.id}/subscription`,
          headers: owner.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    await app.inject({
      method: "DELETE",
      url: `/user-blocks/${owner.user.account.id}`,
      headers: viewer.headers,
    });
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("filters both comment levels for signed-in readers and rejects blocked replies", async () => {
    const { owner, viewer, third, video } = await fixture();
    const ownerComment = await prisma.comment.create({
      data: { videoId: video.id, authorProfileId: owner.user.profile.id, body: "Hidden author" },
    });
    const visible = await prisma.comment.create({
      data: { videoId: video.id, authorProfileId: third.user.profile.id, body: "Visible author" },
    });
    await prisma.comment.create({
      data: {
        videoId: video.id,
        authorProfileId: owner.user.profile.id,
        parentId: visible.id,
        body: "Hidden reply",
      },
    });
    await app.inject({
      method: "POST",
      url: "/user-blocks",
      headers: viewer.headers,
      payload: { profileId: owner.user.profile.id },
    });
    const list = await app.inject({
      method: "GET",
      url: `/comments/videos/${video.id}`,
      headers: viewer.headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toEqual([visible.id]);
    expect(list.json().items[0].replies).toEqual([]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/comments/videos/${video.id}`,
          headers: viewer.headers,
          payload: { body: "No contact", parentId: ownerComment.id },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/comments/${ownerComment.id}/like`,
          headers: viewer.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    // Public content remains publicly accessible to signed-out visitors; block is an account safety preference.
    expect(
      (await app.inject({ method: "GET", url: `/comments/videos/${video.id}` })).json().items,
    ).toHaveLength(2);
  });

  it("denies authenticated blocked channel reads while keeping anonymous availability unchanged", async () => {
    const { owner, viewer } = await fixture();
    await app.inject({
      method: "POST",
      url: "/user-blocks",
      headers: viewer.headers,
      payload: { channelId: owner.user.channel.id },
    });
    const channel = await prisma.channel.findUniqueOrThrow({
      where: { id: owner.user.channel.id },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/public/channels/${channel.handle}`,
          headers: viewer.headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: `/public/channels/${channel.handle}` })).statusCode,
    ).toBe(200);
    await app.inject({ method: "POST", url: "/auth/logout", headers: viewer.headers });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/user-blocks/${owner.user.account.id}`,
          headers: viewer.headers,
        })
      ).statusCode,
    ).toBe(401);
  });
});
