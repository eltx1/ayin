import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";

const url = process.env.TEST_DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;

databaseDescribe("Clips trusted-region policy", () => {
  const prisma = createPrismaClient(url);
  let app: NestFastifyApplication;
  const env = {
    database: process.env.DATABASE_URL,
    auth: process.env.AUTH_TOKEN_SECRET,
    upload: process.env.UPLOAD_SESSION_SECRET,
    token: process.env.AYIN_INTERNAL_EDGE_TOKEN,
    trust: process.env.AYIN_TRUST_CLOUDFLARE_REGION,
  };
  const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const trustedHeaders = {
    "x-ayin-edge-country": "JP",
    "x-ayin-edge-token": "clips-policy-edge-token",
  };

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = url;
    process.env.AUTH_TOKEN_SECRET = "clips-policy-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "clips-policy-upload-secret-with-more-than-32-characters";
    process.env.AYIN_INTERNAL_EDGE_TOKEN = "clips-policy-edge-token";
    process.env.AYIN_TRUST_CLOUDFLARE_REGION = "false";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "PlatformSetting", "Account", "Channel" CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    restore("DATABASE_URL", env.database);
    restore("AUTH_TOKEN_SECRET", env.auth);
    restore("UPLOAD_SESSION_SECRET", env.upload);
    restore("AYIN_INTERNAL_EDGE_TOKEN", env.token);
    restore("AYIN_TRUST_CLOUDFLARE_REGION", env.trust);
  });

  async function channel() {
    return prisma.channel.create({
      data: { id: id(100), name: "Clips policy creator", handle: "clips-policy-creator" },
    });
  }

  async function clip(
    channelId: string,
    n: number,
    options: { visibility?: "PUBLIC" | "PRIVATE"; publishedOffsetMs?: number } = {},
  ) {
    return prisma.video.create({
      data: {
        id: id(n),
        channelId,
        title: "Clip " + n,
        slug: "clip-" + n,
        videoForm: "CLIP",
        status: "PUBLISHED",
        visibility: options.visibility ?? "PUBLIC",
        publishedAt: new Date(Date.now() - (options.publishedOffsetMs ?? n * 1_000)),
        mediaAssets: {
          create: {
            channelId,
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            r2ObjectKey: "clips/" + n + ".mp4",
            mimeType: "video/mp4",
            sizeBytes: 2_048n,
          },
        },
      },
    });
  }

  it("filters policy before pagination and keeps trusted-region traversal full", async () => {
    const c = await channel();
    const [blocked, globalOne, globalTwo, japanOnly, globalThree] = await Promise.all([
      clip(c.id, 1),
      clip(c.id, 2),
      clip(c.id, 3),
      clip(c.id, 4),
      clip(c.id, 5),
    ]);
    await prisma.videoPolicy.createMany({
      data: [
        { videoId: blocked.id, blockedTerritories: ["JP"] },
        { videoId: japanOnly.id, allowedTerritories: ["JP"] },
      ],
    });

    const first = await app.inject({
      url: "/public/clips?take=2",
      headers: trustedHeaders,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.json().items.map((item: { id: string }) => item.id)).toEqual([
      globalOne.id,
      globalTwo.id,
    ]);
    expect(first.json().nextCursor).toBe(globalTwo.id);

    const second = await app.inject({
      url: "/public/clips?take=2&cursor=" + globalTwo.id,
      headers: trustedHeaders,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items.map((item: { id: string }) => item.id)).toEqual([
      japanOnly.id,
      globalThree.id,
    ]);
    expect(second.json().nextCursor).toBeNull();

    for (const headers of [{ "cf-ipcountry": "JP" }, { "x-ayin-edge-country": "JP" }]) {
      const unknown = await app.inject({
        url: "/public/clips?take=10",
        headers,
      });
      expect(unknown.statusCode).toBe(200);
      expect(unknown.json().items.map((item: { id: string }) => item.id)).toEqual([
        globalOne.id,
        globalTwo.id,
        globalThree.id,
      ]);
    }
  });

  it("never lets FORCE_ALLOW bypass private playback boundaries", async () => {
    const c = await channel();
    const privateClip = await clip(c.id, 1, { visibility: "PRIVATE" });
    const publicClip = await clip(c.id, 2);
    const actor = await prisma.account.create({
      data: { email: "clips-policy-actor@example.test", displayName: "Clips policy actor" },
    });
    await prisma.videoPolicyOverride.create({
      data: {
        videoId: privateClip.id,
        disposition: "FORCE_ALLOW",
        actorAccountId: actor.id,
        reason: "Policy boundary fixture",
      },
    });

    const response = await app.inject({ url: "/public/clips?take=10", headers: trustedHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([publicClip.id]);
  });
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
