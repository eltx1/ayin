import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const storage = { kind: "r2", available: true } as unknown as MediaStorageAdapter;

databaseDescribe("Live Viewer public boundary", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "live-viewer-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "live-viewer-upload-secret-with-more-than-32-characters";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
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

  async function register(name: string, email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name, email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    const setCookie = response.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return {
      cookie: raw?.split(";", 1)[0] ?? "",
      user: response.json().user as {
        account: { id: string };
        profile: { id: string };
        channel: { id: string };
      },
    };
  }

  it("returns only Viewer-safe stream/chat fields and keeps chat writes authenticated", async () => {
    const owner = await register("Live owner", "live-viewer-owner@example.com");
    const viewer = await register("Live viewer", "live-viewer-viewer@example.com");
    const stream = await prisma.liveStream.create({
      data: {
        channelId: owner.user.channel.id,
        createdByAccountId: owner.user.account.id,
        slug: "viewer-safe-live",
        title: "Viewer safe live",
        description: "Public description",
        status: "LIVE",
        providerKey: "mux",
        providerStreamId: "mux-private-stream",
        streamKeyHash: "private-hash",
        ingestEndpoint: "rtmps://private.example.test/live",
        playbackUrl: "https://stream.example.test/viewer-safe.m3u8",
        providerRecordingAssetId: "private-recording-asset",
        recordingHandoffError: "private operator detail",
        chatEnabled: true,
        adBreaksEnabled: true,
        startedAt: new Date("2026-10-03T00:00:00.000Z"),
      },
    });

    const publicResponse = await app.inject({
      method: "GET",
      url: `/live/${stream.slug}`,
    });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.headers["cache-control"]).toBe("private, no-store");
    const publicBody = publicResponse.json();
    expect(Object.keys(publicBody).sort()).toEqual(
      [
        "captions",
        "channel",
        "chatEnabled",
        "description",
        "dvrWindowSeconds",
        "id",
        "playbackUrl",
        "scheduledStartAt",
        "status",
        "title",
      ].sort(),
    );
    expect(publicBody).toMatchObject({
      id: stream.id,
      title: "Viewer safe live",
      status: "LIVE",
      playbackUrl: "https://stream.example.test/viewer-safe.m3u8",
      chatEnabled: true,
      captions: [],
      dvrWindowSeconds: null,
      channel: { id: owner.user.channel.id, name: "Live owner" },
    });
    expect(JSON.stringify(publicBody)).not.toMatch(
      /mux-private-stream|private-hash|rtmps|private-recording-asset|operator detail|adBreak/i,
    );

    const anonymousPost = await app.inject({
      method: "POST",
      url: `/live/${stream.slug}/chat`,
      payload: { body: "Hello live" },
    });
    expect(anonymousPost.statusCode).toBe(401);

    const posted = await app.inject({
      method: "POST",
      url: `/live/${stream.slug}/chat`,
      headers: { cookie: viewer.cookie },
      payload: { body: "Hello live" },
    });
    expect(posted.statusCode).toBe(201);
    expect(Object.keys(posted.json()).sort()).toEqual(["body", "createdAt", "id"].sort());
    expect(posted.json().body).toBe("Hello live");

    const chat = await app.inject({
      method: "GET",
      url: `/live/${stream.slug}/chat`,
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.headers["cache-control"]).toBe("private, no-store");
    expect(chat.json().chatEnabled).toBe(true);
    expect(chat.json().messages).toHaveLength(1);
    expect(Object.keys(chat.json().messages[0]).sort()).toEqual(["body", "createdAt", "id"].sort());
    expect(JSON.stringify(chat.json())).not.toContain(viewer.user.profile.id);
  });
  it("returns the latest bounded published chat window in deterministic chronological order", async () => {
    const owner = await register("Window owner", "live-window-owner@example.com");
    const stream = await prisma.liveStream.create({
      data: {
        channelId: owner.user.channel.id,
        createdByAccountId: owner.user.account.id,
        slug: "live-chat-window",
        title: "Chat window",
        status: "LIVE",
        chatEnabled: true,
      },
    });
    const start = Date.parse("2026-10-03T00:00:00.000Z");
    await prisma.liveChatMessage.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        liveStreamId: stream.id,
        authorProfileId: owner.user.profile.id,
        body: `Message ${i}`,
        createdAt: new Date(start + i * 1000),
        status: i === 204 ? ("HIDDEN" as const) : ("PUBLISHED" as const),
      })),
    });
    const response = await app.inject({ method: "GET", url: `/live/${stream.slug}/chat` });
    expect(response.statusCode).toBe(200);
    const messages = response.json().messages as Array<{ body: string; createdAt: string }>;
    expect(messages).toHaveLength(200);
    expect(messages[0]?.body).toBe("Message 4");
    expect(messages.at(-1)?.body).toBe("Message 203");
    expect(messages.some((message) => message.body === "Message 204")).toBe(false);
    expect(
      messages.every(
        (message, index) =>
          index === 0 ||
          Date.parse(message.createdAt) >= Date.parse(messages[index - 1]!.createdAt),
      ),
    ).toBe(true);
  });
});
