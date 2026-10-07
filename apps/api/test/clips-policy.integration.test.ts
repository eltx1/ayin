import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { ClipsService } from "../src/creator/clips.service.js";
import { VideoPolicyService } from "../src/video-policy/video-policy.service.js";

const url = process.env.TEST_DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;

databaseDescribe("Clips current viewer and trusted-region policy on PostgreSQL", () => {
  const prisma = createPrismaClient(url);
  let app: NestFastifyApplication;
  const env = {
    app: process.env.APP_ENV,
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
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "PlatformSetting", "Account", "Channel" CASCADE',
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
    restore("APP_ENV", env.app);
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

  async function register(kids = false) {
    const email = `clips-${randomUUID()}@example.test`;
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Clips viewer", email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    const identity = response.json().user as { account: { id: string }; profile: { id: string } };
    const header = response.headers["set-cookie"];
    const cookie = (Array.isArray(header) ? header[0] : header)!.split(";", 1)[0]!;
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-ayin-auth-transport": "bearer" },
      payload: { email, password: "strong-pass-123" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toBeUndefined();
    if (kids) {
      await prisma.viewerProfile.update({
        where: { id: identity.profile.id },
        data: { isKids: true },
      });
    }
    return { ...identity, cookie, token: login.json().sessionToken as string };
  }

  async function enableAds() {
    await prisma.platformSetting.create({
      data: { namespace: "ADVERTISING", key: "clipsAdsEnabled", valueType: "BOOLEAN", value: true },
    });
  }

  async function kidsPolicy(videoId: string) {
    await prisma.videoPolicy.create({
      data: { videoId, kidsEligible: true, maturityLevel: "GENERAL", ageRestriction: "NONE" },
    });
  }

  function read(headers: Record<string, string> = {}, query = "take=10") {
    return app.inject({ url: `/public/clips?${query}`, headers });
  }

  function holdAfterPolicy(update: () => Promise<unknown>) {
    const service = app.get(VideoPolicyService);
    const original = service.filterAvailableVideoIds.bind(service);
    vi.spyOn(service, "filterAvailableVideoIds").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await update();
      return result;
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

  it.each(["cookie", "bearer"])(
    "filters the current Kids audience before pagination with real %s auth and disables ads",
    async (transport) => {
      const viewer = await register(true);
      const c = await channel();
      const [unclassified, mature, safeOne, regionBlocked, safeTwo, safeThree] = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) => clip(c.id, n)),
      );
      await enableAds();
      await prisma.videoPolicy.createMany({
        data: [
          {
            videoId: mature!.id,
            kidsEligible: true,
            maturityLevel: "MATURE",
            ageRestriction: "AGE_18_PLUS",
          },
          {
            videoId: safeOne!.id,
            kidsEligible: true,
            maturityLevel: "GENERAL",
            ageRestriction: "NONE",
          },
          {
            videoId: regionBlocked!.id,
            kidsEligible: true,
            maturityLevel: "GENERAL",
            ageRestriction: "NONE",
            blockedTerritories: ["JP"],
          },
          {
            videoId: safeTwo!.id,
            kidsEligible: true,
            maturityLevel: "GENERAL",
            ageRestriction: "NONE",
            allowedTerritories: ["JP"],
          },
          {
            videoId: safeThree!.id,
            kidsEligible: true,
            maturityLevel: "GENERAL",
            ageRestriction: "NONE",
          },
        ],
      });
      await prisma.videoPolicyOverride.create({
        data: {
          videoId: mature!.id,
          disposition: "FORCE_ALLOW",
          actorAccountId: viewer.account.id,
          reason: "Kids boundary fixture",
        },
      });
      const auth: Record<string, string> =
        transport === "cookie"
          ? { cookie: viewer.cookie }
          : { authorization: `Bearer ${viewer.token}` };
      const headers = { ...trustedHeaders, ...auth, "x-ayin-expected-account": viewer.account.id };
      const first = await read(headers, `take=2&expectedProfileId=${viewer.profile.id}`);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        viewer: { isKids: true },
        adPolicy: { enabled: false },
        nextCursor: safeTwo!.id,
      });
      expect(first.json().items.map((item: { id: string }) => item.id)).toEqual([
        safeOne!.id,
        safeTwo!.id,
      ]);
      expect(first.body).not.toContain(unclassified!.id);
      expect(first.body).not.toContain(mature!.id);
      const second = await read(
        headers,
        `take=2&cursor=${safeTwo!.id}&expectedProfileId=${viewer.profile.id}`,
      );
      expect(second.statusCode).toBe(200);
      expect(second.json().items.map((item: { id: string }) => item.id)).toEqual([safeThree!.id]);
      expect(second.json().nextCursor).toBeNull();

      const forged = await read({ ...auth, "cf-ipcountry": "JP", "x-ayin-country": "JP" });
      expect(forged.json().items.map((item: { id: string }) => item.id)).toEqual([
        safeOne!.id,
        safeThree!.id,
      ]);
      for (const query of ["isKidsProfile=false", "kids=0", `profileId=${viewer.profile.id}`]) {
        const spoofed = await read(headers, `take=2&${query}`);
        expect(spoofed.statusCode).toBe(400);
        expect(spoofed.body).not.toContain(mature!.id);
      }
    },
  );

  it("preserves anonymous/adult feeds and authoritative audience metadata for empty and disabled feeds", async () => {
    const viewer = await register();
    const c = await channel();
    const adult = await clip(c.id, 1);
    await enableAds();
    for (const headers of [
      {},
      { cookie: viewer.cookie },
      { authorization: `Bearer ${viewer.token}` },
    ]) {
      const response = await read(headers);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        viewer: { isKids: false },
        adPolicy: { enabled: true },
      });
      expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([adult.id]);
    }
    await prisma.viewerProfile.update({ where: { id: viewer.profile.id }, data: { isKids: true } });
    const empty = await read({ cookie: viewer.cookie });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      enabled: true,
      viewer: { isKids: true },
      items: [],
      adPolicy: { enabled: false },
    });
    await prisma.platformSetting.create({
      data: { namespace: "DISCOVERY", key: "clipsEnabled", valueType: "BOOLEAN", value: false },
    });
    const disabled = await read({ cookie: viewer.cookie });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({
      enabled: false,
      viewer: { isKids: true },
      items: [],
      adPolicy: { enabled: false },
    });
  });

  it("uses profile IDs only as equality fences and binds authenticated account and session", async () => {
    const viewer = await register(true);
    const foreign = await register();
    const other = await prisma.viewerProfile.create({
      data: { accountId: viewer.account.id, name: "Adult", slug: "adult", isKids: false },
    });
    const service = vi.spyOn(app.get(ClipsService), "feed");
    for (const expected of [foreign.profile.id, other.id]) {
      const response = await read({ cookie: viewer.cookie }, `expectedProfileId=${expected}`);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("CLIPS_VIEWER_CHANGED");
    }
    expect((await read({}, `expectedProfileId=${viewer.profile.id}`)).statusCode).toBe(409);
    const accountChanged = await read({
      cookie: foreign.cookie,
      "x-ayin-expected-account": viewer.account.id,
    });
    expect(accountChanged.statusCode).toBe(409);
    expect(accountChanged.json().error.code).toBe("ACCOUNT_CHANGED");
    const sessionChanged = await read({
      cookie: viewer.cookie,
      "x-ayin-expected-session": randomUUID(),
    });
    expect(sessionChanged.statusCode).toBe(409);
    expect(sessionChanged.json().error.code).toBe("SESSION_CHANGED");
    expect(service).not.toHaveBeenCalled();

    await prisma.viewerProfile.update({
      where: { id: viewer.profile.id },
      data: { isDefault: false },
    });
    await prisma.viewerProfile.update({ where: { id: other.id }, data: { isDefault: true } });
    expect(
      (await read({ cookie: viewer.cookie }, `expectedProfileId=${viewer.profile.id}`)).statusCode,
    ).toBe(409);
    expect((await read({ cookie: viewer.cookie })).json().viewer).toEqual({ isKids: false });
  });

  it("preserves explicit bearer authority over conflicting cookies and rejects revoked auth", async () => {
    const adult = await register();
    const kids = await register(true);
    const c = await channel();
    const item = await clip(c.id, 1);
    const response = await read({ cookie: adult.cookie, authorization: `Bearer ${kids.token}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ viewer: { isKids: true }, items: [] });
    expect(response.body).not.toContain(item.id);
    for (const authorization of ["Basic invalid", "Bearer "]) {
      expect((await read({ cookie: adult.cookie, authorization })).statusCode).toBe(401);
    }
    expect((await read({ cookie: "ayin_session=invalid" })).statusCode).toBe(401);
    await prisma.accountSession.updateMany({
      where: { accountId: adult.account.id },
      data: { revokedAt: new Date() },
    });
    expect((await read({ cookie: adult.cookie })).statusCode).toBe(401);
    expect((await read({ authorization: `Bearer ${adult.token}` })).statusCode).toBe(401);
  });

  it.each(["switch", "kind", "delete"])(
    "rejects a held feed after current profile %s",
    async (change) => {
      const viewer = await register();
      const c = await channel();
      const item = await clip(c.id, 1);
      const service = app.get(ClipsService);
      const original = service.feed.bind(service);
      vi.spyOn(service, "feed").mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        if (change === "switch") {
          await prisma.viewerProfile.update({
            where: { id: viewer.profile.id },
            data: { isDefault: false },
          });
          await prisma.viewerProfile.create({
            data: {
              accountId: viewer.account.id,
              name: "New default",
              slug: "new-default",
              isDefault: true,
            },
          });
        } else {
          await prisma.viewerProfile.update({
            where: { id: viewer.profile.id },
            data: change === "kind" ? { isKids: true } : { deletedAt: new Date() },
          });
        }
        return result;
      });
      const response = await read({ cookie: viewer.cookie });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("CLIPS_VIEWER_CHANGED");
      expect(response.body).not.toContain(item.id);
      expect(response.body).not.toContain("clips/1.mp4");
      if (change === "delete") expect((await read({ cookie: viewer.cookie })).statusCode).toBe(409);
    },
  );

  it.each(["removed", "invalid", "object", "kind"])(
    "never substitutes another source after the selected asset becomes %s during a held read",
    async (change) => {
      const c = await channel();
      const item = await clip(c.id, 1);
      const source = await prisma.mediaAsset.findFirstOrThrow({
        where: { videoId: item.id, kind: "SOURCE_VIDEO" },
      });
      await prisma.mediaAsset.create({
        data: {
          videoId: item.id,
          channelId: c.id,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          r2ObjectKey: "clips/alternate.mp4",
          mimeType: "video/mp4",
          sizeBytes: 1024n,
          createdAt: new Date(0),
        },
      });
      holdAfterPolicy(() =>
        prisma.mediaAsset.update({
          where: { id: source.id },
          data:
            change === "removed"
              ? { removedAt: new Date() }
              : change === "invalid"
                ? { status: "REJECTED" }
                : change === "object"
                  ? { r2ObjectKey: "clips/replaced.mp4" }
                  : { kind: "THUMBNAIL" },
        }),
      );
      const response = await read();
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([]);
      expect(response.body).not.toContain("clips/1.mp4");
      expect(response.body).not.toContain("clips/alternate.mp4");
    },
  );

  it.each(["visibility", "publication", "channel", "kids", "rights", "territory", "override"])(
    "rechecks current %s after asynchronous hydration and policy work",
    async (change) => {
      const viewer = await register(true);
      const c = await channel();
      const item = await clip(c.id, 1);
      await kidsPolicy(item.id);
      holdAfterPolicy(async () => {
        if (change === "visibility")
          return prisma.video.update({ where: { id: item.id }, data: { visibility: "PRIVATE" } });
        if (change === "publication")
          return prisma.video.update({ where: { id: item.id }, data: { status: "DRAFT" } });
        if (change === "channel")
          return prisma.channel.update({ where: { id: c.id }, data: { removedAt: new Date() } });
        if (change === "override")
          return prisma.videoPolicyOverride.create({
            data: {
              videoId: item.id,
              actorAccountId: viewer.account.id,
              disposition: "FORCE_BLOCK",
              reason: "Held policy fixture",
            },
          });
        return prisma.videoPolicy.update({
          where: { videoId: item.id },
          data:
            change === "kids"
              ? { kidsEligible: false }
              : change === "rights"
                ? { rightsExpiresAt: new Date(0) }
                : { allowedTerritories: ["DE"] },
        });
      });
      const response = await read({ cookie: viewer.cookie, ...trustedHeaders });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([]);
      expect(response.json().viewer).toEqual({ isKids: true });
      expect(response.body).not.toContain("clips/1.mp4");
    },
  );

  it("uses a fresh final clock when rights expire during a held read and keeps the page cursor", async () => {
    const c = await channel();
    const first = await clip(c.id, 1);
    const second = await clip(c.id, 2);
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.videoPolicy.create({ data: { videoId: first.id, rightsExpiresAt: expiresAt } });
    holdAfterPolicy(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(expiresAt.getTime() + 1));
    });
    try {
      const response = await read({}, "take=1");
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([]);
      expect(response.json().nextCursor).toBe(first.id);
      const next = await read({}, `take=1&cursor=${first.id}`);
      expect(next.statusCode).toBe(200);
      expect(next.json().items.map((item: { id: string }) => item.id)).toEqual([second.id]);
      expect(next.json().nextCursor).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
