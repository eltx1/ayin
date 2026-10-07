import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { FeatureFlagService } from "../src/platform-config/feature-flag.service.js";
import { applyApiSecurityHeaders } from "../src/security/request-security.js";
import { WatchService } from "../src/watch/watch.service.js";

// The vanished original suite was only partially recoverable. Setup and the
// marked additional cases were reauthored on 2026-10-07; retained cases below
// preserve their original assertions. All data belongs to this disposable run.
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const edgeToken = "playback-viewer-policy-controlled-edge-token-more-than32";
type Identity = {
  account: { id: string };
  profile: { id: string };
  channel: { id: string };
  cookie: string;
  token: string;
};
type Video = { id: string; slug: string; sourceId: string; objectKey: string };

databaseDescribe("Playback current viewer/source disclosure on PostgreSQL", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  let viewer: Identity;
  let foreign: Identity;
  let otherProfileId: string;
  let adult: Video;
  let safe: Video;
  const videos: Video[] = [];

  beforeAll(async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("AUTH_TOKEN_SECRET", "playback-viewer-policy-test-secret-more-than32");
    vi.stubEnv("UPLOAD_SESSION_SECRET", "playback-viewer-upload-test-secret-more-than32");
    vi.stubEnv("DATABASE_URL", databaseUrl!);
    vi.stubEnv("WEB_ORIGIN", "http://localhost:3000");
    vi.stubEnv("AYIN_E2E_STORAGE", "1");
    vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", edgeToken);
    vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "false");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
    fastify.addHook("onRequest", async (request, reply) => {
      applyApiSecurityHeaders(reply, request);
    });
    await app.init();
    await fastify.ready();
    viewer = await register("Playback viewer");
    foreign = await register("Other playback viewer");
    otherProfileId = (
      await prisma.viewerProfile.create({
        data: { accountId: viewer.account.id, name: "Other adult", slug: "other-adult" },
      })
    ).id;
    adult = await video(false);
    safe = await video(true);
    videos.push(adult, safe);
    const caption = await prisma.mediaAsset.create({
      data: {
        videoId: safe.id,
        channelId: viewer.channel.id,
        kind: "CAPTION",
        status: "VALIDATED",
        mimeType: "text/vtt",
        r2ObjectKey: `playback-viewer-policy/${safe.id}/en.vtt`,
        sizeBytes: 128n,
      },
    });
    await prisma.videoCaptionTrack.create({
      data: {
        videoId: safe.id,
        mediaAssetId: caption.id,
        languageCode: "en",
        label: "English",
        isDefault: true,
      },
    });
  }, 30_000);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.mediaAsset.deleteMany({
      where: {
        videoId: { in: videos.map((item) => item.id) },
        kind: "SOURCE_VIDEO",
        id: { notIn: videos.map((item) => item.sourceId) },
      },
    });
    await prisma.viewerProfile.updateMany({
      where: { accountId: { in: [viewer.account.id, foreign.account.id] } },
      data: { isDefault: false, isKids: false, deletedAt: null },
    });
    await prisma.viewerProfile.updateMany({
      where: { id: { in: [viewer.profile.id, foreign.profile.id] } },
      data: { isDefault: true },
    });
    await prisma.accountSession.updateMany({
      where: { accountId: { in: [viewer.account.id, foreign.account.id] } },
      data: { revokedAt: null },
    });
    for (const item of videos) {
      await prisma.video.update({
        where: { id: item.id },
        data: { status: "PUBLISHED", visibility: "PUBLIC", removedAt: null },
      });
      await prisma.mediaAsset.update({
        where: { id: item.sourceId },
        data: { status: "VALIDATED", removedAt: null, r2ObjectKey: item.objectKey },
      });
      await prisma.videoPolicy.update({
        where: { videoId: item.id },
        data: { rightsExpiresAt: null },
      });
    }
    await prisma.videoPolicy.update({
      where: { videoId: safe.id },
      data: { kidsEligible: true, allowedTerritories: [] },
    });
  });

  beforeEach(async () => {
    await prisma.mediaPlaybackGeneration.deleteMany({
      where: { videoId: { in: videos.map((item) => item.id) } },
    });
    await prisma.channel.update({
      where: { id: viewer.channel.id },
      data: { status: "ACTIVE", removedAt: null },
    });
    await prisma.videoPolicy.updateMany({
      where: { videoId: { in: videos.map((item) => item.id) } },
      data: { blockedTerritories: [] },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    const identities = [viewer, foreign].filter(Boolean);
    const channelIds = identities.map((identity) => identity.channel.id);
    const videoIds = videos.map((item) => item.id);
    await prisma.videoCaptionTrack.deleteMany({ where: { videoId: { in: videoIds } } });
    await prisma.videoPolicy.deleteMany({ where: { videoId: { in: videoIds } } });
    await prisma.video.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.creatorContract.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
    await prisma.account.deleteMany({
      where: { id: { in: identities.map((identity) => identity.account.id) } },
    });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  async function register(name: string): Promise<Identity> {
    const credentials = {
      email: `playback-${randomUUID()}@example.test`,
      password: "strong-pass-123",
    };
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name, ...credentials },
    });
    expect(response.statusCode).toBe(201);
    const header = response.headers["set-cookie"];
    const nativeLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-ayin-auth-transport": "bearer" },
      payload: credentials,
    });
    expect(nativeLogin.statusCode).toBe(200);
    expect(nativeLogin.headers["set-cookie"]).toBeUndefined();
    const token = nativeLogin.json().sessionToken as string;
    expect(token).toEqual(expect.any(String));
    return {
      ...response.json().user,
      token,
      cookie: (Array.isArray(header) ? header[0] : header)!.split(";", 1)[0]!,
    };
  }

  async function video(kidsEligible: boolean): Promise<Video> {
    const objectKey = `playback-viewer-policy/${randomUUID()}.mp4`;
    const created = await prisma.video.create({
      data: {
        channelId: viewer.channel.id,
        slug: `playback-policy-${randomUUID()}`,
        title: kidsEligible ? "Policy safe video" : "Policy adult video",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
        durationMs: 120_000,
        mediaAssets: {
          create: {
            channelId: viewer.channel.id,
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            mimeType: "video/mp4",
            r2ObjectKey: objectKey,
            sizeBytes: 1024n,
          },
        },
      },
      include: { mediaAssets: true },
    });
    await prisma.videoPolicy.create({
      data: {
        videoId: created.id,
        kidsEligible,
        maturityLevel: kidsEligible ? "GENERAL" : "MATURE",
        ageRestriction: kidsEligible ? "NONE" : "AGE_18_PLUS",
      },
    });
    return { id: created.id, slug: created.slug, sourceId: created.mediaAssets[0]!.id, objectKey };
  }

  function read(item: Video, headers: Record<string, string> = {}, query = "") {
    return app.inject({
      method: "GET",
      url: `/public/videos/${item.slug}/playback${query}`,
      headers,
    });
  }

  function heldRead(update: () => Promise<unknown>) {
    const service = app.get(WatchService);
    const original = service.getPublicPlayback.bind(service);
    vi.spyOn(service, "getPublicPlayback").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await update();
      return result;
    });
  }

  function expectNoSource(
    response: { body: string; statusCode: number },
    item: Video,
    status: number,
  ) {
    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain(item.objectKey);
    expect(response.body).not.toContain('"source"');
    expect(response.body).not.toContain('"adaptiveSource"');
  }

  it.each(["cookie", "bearer"])(
    "blocks an ordinary Kids adult-video deep link using real %s auth",
    async (transport) => {
      await prisma.viewerProfile.update({
        where: { id: viewer.profile.id },
        data: { isKids: true },
      });
      const headers =
        transport === "cookie"
          ? { cookie: viewer.cookie }
          : { authorization: `Bearer ${viewer.token}` };
      expectNoSource(
        await read(
          adult,
          headers,
          `?kids=0&isKidsProfile=false&expectedProfileId=${viewer.profile.id}`,
        ),
        adult,
        404,
      );
      const approved = await read(safe, headers);
      expect(approved.statusCode).toBe(200);
      expect(approved.headers["cache-control"]).toBe("private, no-store");
      expect(approved.json()).toMatchObject({
        viewer: { isKids: true },
        video: { id: safe.id },
        detail: {
          commentsSlot: { enabled: false },
          adTargetingPolicy: { inventoryClass: "KIDS", personalizedTargetingAllowed: false },
          seriesContext: null,
        },
      });
      expect(approved.body).not.toContain(adult.id);
      expect(approved.json().video.captions).toEqual([
        expect.objectContaining({
          label: "English",
          language: "en",
          mimeType: "text/vtt",
          default: true,
        }),
      ]);
    },
  );

  it("preserves ordinary anonymous and adult playback, with explicit Kids restrictions", async () => {
    for (const headers of [
      {},
      { cookie: viewer.cookie },
      { authorization: `Bearer ${viewer.token}` },
    ]) {
      const response = await read(adult, headers);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        viewer: { isKids: false },
        video: { source: { objectKey: adult.objectKey } },
      });
      expectNoSource(await read(adult, headers, "?kids=1"), adult, 404);
      expect((await read(safe, headers, "?kids=1")).json().viewer).toEqual({ isKids: true });
    }
  });

  it("binds current account/profile, rejects stale defaults and cannot select a foreign or adult nondefault", async () => {
    const headers = { cookie: viewer.cookie, "x-ayin-expected-account": viewer.account.id };
    expect((await read(adult, headers, `?expectedProfileId=${viewer.profile.id}`)).statusCode).toBe(
      200,
    );
    for (const profileId of [foreign.profile.id, otherProfileId]) {
      const response = await read(adult, headers, `?expectedProfileId=${profileId}`);
      expectNoSource(response, adult, 409);
      expect(response.json().error.code).toBe("PLAYBACK_VIEWER_CHANGED");
    }
    expectNoSource(await read(adult, {}, `?expectedProfileId=${viewer.profile.id}`), adult, 409);
    expectNoSource(
      await read(adult, { cookie: foreign.cookie, "x-ayin-expected-account": viewer.account.id }),
      adult,
      409,
    );
    await prisma.viewerProfile.update({
      where: { id: viewer.profile.id },
      data: { isDefault: false },
    });
    await prisma.viewerProfile.update({
      where: { id: otherProfileId },
      data: { isDefault: true, isKids: true },
    });
    expectNoSource(
      await read(adult, headers, `?expectedProfileId=${viewer.profile.id}`),
      adult,
      409,
    );
    expectNoSource(await read(adult, headers), adult, 404);
  });

  // Additional cases reauthored from the current API contract after recovery.
  it.each(["cookie", "bearer"])(
    "rejects revoked supplied %s credentials before source disclosure",
    async (transport) => {
      await prisma.accountSession.updateMany({
        where: { accountId: viewer.account.id },
        data: { revokedAt: new Date() },
      });
      expectNoSource(
        await read(
          adult,
          transport === "cookie"
            ? { cookie: viewer.cookie }
            : { authorization: `Bearer ${viewer.token}` },
        ),
        adult,
        401,
      );
    },
  );

  it.each(["kind", "default", "deleted"])(
    "discards a prepared adult source after held viewer %s change",
    async (change) => {
      heldRead(async () => {
        if (change === "kind")
          return prisma.viewerProfile.update({
            where: { id: viewer.profile.id },
            data: { isKids: true },
          });
        if (change === "deleted")
          return prisma.viewerProfile.update({
            where: { id: viewer.profile.id },
            data: { deletedAt: new Date() },
          });
        await prisma.viewerProfile.update({
          where: { id: viewer.profile.id },
          data: { isDefault: false },
        });
        return prisma.viewerProfile.update({
          where: { id: otherProfileId },
          data: { isDefault: true },
        });
      });
      expectNoSource(await read(adult, { cookie: viewer.cookie }), adult, 409);
    },
  );

  it.each(["private", "removed", "channel", "rights", "kids", "source"])(
    "rejects a prepared source after held %s revocation",
    async (change) => {
      await prisma.viewerProfile.update({
        where: { id: viewer.profile.id },
        data: { isKids: true },
      });
      heldRead(async () => {
        if (change === "private")
          return prisma.video.update({ where: { id: safe.id }, data: { visibility: "PRIVATE" } });
        if (change === "removed")
          return prisma.video.update({ where: { id: safe.id }, data: { removedAt: new Date() } });
        if (change === "channel")
          return prisma.channel.update({
            where: { id: viewer.channel.id },
            data: { removedAt: new Date() },
          });
        if (change === "rights")
          return prisma.videoPolicy.update({
            where: { videoId: safe.id },
            data: { rightsExpiresAt: new Date(Date.now() - 1_000) },
          });
        if (change === "kids")
          return prisma.videoPolicy.update({
            where: { videoId: safe.id },
            data: { kidsEligible: false },
          });
        return prisma.mediaAsset.update({
          where: { id: safe.sourceId },
          data: { removedAt: new Date() },
        });
      });
      expectNoSource(await read(safe, { cookie: viewer.cookie }), safe, 404);
    },
  );

  it("uses only trusted territory and rechecks a held territory change", async () => {
    await prisma.videoPolicy.update({
      where: { videoId: safe.id },
      data: { allowedTerritories: ["JP"] },
    });
    expectNoSource(
      await read(safe, { cookie: viewer.cookie, "cf-ipcountry": "JP", "x-ayin-country": "JP" }),
      safe,
      404,
    );
    const headers = {
      cookie: viewer.cookie,
      "x-ayin-edge-token": edgeToken,
      "x-ayin-edge-country": "JP",
    };
    expect((await read(safe, headers)).statusCode).toBe(200);
    heldRead(() =>
      prisma.videoPolicy.update({
        where: { videoId: safe.id },
        data: { blockedTerritories: ["JP"] },
      }),
    );
    expectNoSource(await read(safe, headers), safe, 404);
  });

  it("rejects replacement of the selected asset even if a new validated asset reuses its object key", async () => {
    heldRead(async () => {
      await prisma.mediaAsset.update({
        where: { id: safe.sourceId },
        data: { removedAt: new Date(), r2ObjectKey: `${safe.objectKey}.retired` },
      });
      await prisma.mediaAsset.create({
        data: {
          videoId: safe.id,
          channelId: viewer.channel.id,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          r2ObjectKey: safe.objectKey,
          mimeType: "video/mp4",
          sizeBytes: 1024n,
        },
      });
    });
    expectNoSource(await read(safe, { cookie: viewer.cookie }), safe, 404);
  });
  it("binds held HLS and fallback disclosure to the exact still-ready generation", async () => {
    const flags = app.get(FeatureFlagService);
    const original = flags.isEnabled.bind(flags);
    vi.spyOn(flags, "isEnabled").mockImplementation((key, ...args) =>
      key === "player.hls.enabled" ? Promise.resolve(true) : original(key, ...args),
    );
    const generation = await prisma.mediaPlaybackGeneration.create({
      data: {
        videoId: safe.id,
        sourceMediaAssetId: safe.sourceId,
        generation: 1,
        status: "READY",
        fallbackR2ObjectKey: `playback-viewer-policy/${safe.id}/g1.mp4`,
        fallbackStatus: "READY",
        hlsMasterR2ObjectKey: `playback-viewer-policy/${safe.id}/g1/master.m3u8`,
        hlsMasterStatus: "READY",
        renditions: {
          create: {
            identity: "360p",
            width: 640,
            height: 360,
            videoBitrateKbps: 700,
            audioBitrateKbps: 96,
            playlistR2ObjectKey: `playback-viewer-policy/${safe.id}/g1/360p/index.m3u8`,
            segmentR2Prefix: `playback-viewer-policy/${safe.id}/g1/360p/`,
            status: "READY",
          },
        },
      },
    });
    const allowed = await read(safe, { cookie: viewer.cookie });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().video.source.objectKey).toBe(generation.fallbackR2ObjectKey);
    expect(allowed.json().video.adaptiveSource.objectKey).toBe(generation.hlsMasterR2ObjectKey);
    heldRead(() =>
      prisma.mediaPlaybackGeneration.update({
        where: { id: generation.id },
        data: { status: "SUPERSEDED" },
      }),
    );
    const response = await read(safe, { cookie: viewer.cookie });
    expectNoSource(response, safe, 404);
    expect(response.body).not.toContain(generation.fallbackR2ObjectKey);
    expect(response.body).not.toContain(generation.hlsMasterR2ObjectKey);
  });
});
