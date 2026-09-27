import { randomUUID } from "node:crypto";

import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { availableVideoPolicySql } from "../src/video-policy/video-policy-query.js";
import { evaluatePolicy } from "../src/video-policy/video-policy.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { AppModule } from "../src/app.module.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const edgeToken = "task-62-edge-token-with-more-than-32-characters";

const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "discovery-upload" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/upload",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({ sizeBytes: 1024, contentType: "video/mp4", etag: '"video"' })),
  deleteObject: vi.fn(async () => undefined),
  deletePrefix: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

interface RegisteredUser {
  cookie: string;
  user: {
    account: { id: string };
    profile: { id: string };
    channel: { id: string };
  };
}

databaseDescribe("Task 12 discovery and My AYIN", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-12-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "task-12-upload-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.AYIN_INTERNAL_EDGE_TOKEN = edgeToken;

    moduleReference = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AdminRoleAssignment" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "PlatformSetting" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "HomeRowConfig" CASCADE');
    await prisma.homeRowConfig.createMany({
      data: [
        {
          key: "continue-watching",
          title: "Continue Watching",
          source: "CONTINUE_WATCHING",
          audience: "AUTHENTICATED",
          position: 10,
          maxItems: 4,
        },
        {
          key: "new-on-ayin",
          title: "New on AYIN",
          source: "NEW_ON_AYIN",
          audience: "ALL",
          position: 20,
          maxItems: 4,
        },
        {
          key: "creator-tv",
          title: "Creator TV",
          source: "CREATOR_TV",
          audience: "ALL",
          position: 30,
          maxItems: 4,
        },
        {
          key: "popular-region",
          title: "Popular Near You",
          source: "POPULAR_REGION",
          audience: "ALL",
          enabled: true,
          position: 40,
          maxItems: 4,
          regionPersonalizationRequired: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register(name: string, email: string): Promise<RegisteredUser> {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name, email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    return {
      cookie: cookiePair(response.headers["set-cookie"]),
      user: response.json().user as RegisteredUser["user"],
    };
  }

  async function publishVideo(channelId: string, title: string, publishedAt = new Date()) {
    const id = randomUUID();
    const slug = `task12-${id.slice(0, 8)}`;
    await prisma.video.create({
      data: {
        id,
        channelId,
        slug,
        title,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: 100_000,
        publishedAt,
      },
    });
    await prisma.mediaAsset.create({
      data: {
        id: randomUUID(),
        channelId,
        videoId: id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `channels/${channelId}/media/${id}/source.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
        durationMs: 100_000,
      },
    });
    return { id, slug };
  }

  it("renders configured rows in database order using only real eligible data", async () => {
    const viewer = await register("Discovery Viewer", "task12-viewer@example.com");
    const video = await publishVideo(viewer.user.channel.id, "Real discovery video");
    await app.inject({
      method: "PUT",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: viewer.cookie },
      payload: { positionMs: 25_000, durationMs: 100_000 },
    });

    const authenticated = await app.inject({
      method: "GET",
      url: "/discovery/home",
      headers: { cookie: viewer.cookie },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json().rows.map((row: { key: string }) => row.key)).toEqual([
      "continue-watching",
      "new-on-ayin",
      "creator-tv",
    ]);
    expect(authenticated.json().rows[0].items[0]).toMatchObject({
      type: "VIDEO",
      title: "Real discovery video",
      progress: { positionMs: 25_000 },
    });

    const publicHome = await app.inject({ method: "GET", url: "/public/discovery/home" });
    expect(publicHome.statusCode).toBe(200);
    expect(publicHome.json().rows.map((row: { key: string }) => row.key)).toEqual([
      "new-on-ayin",
      "creator-tv",
    ]);
  });

  it("paginates large rows without per-item queries or fake catalog entries", async () => {
    const viewer = await register("Paging Viewer", "task12-paging@example.com");
    // NEW_ON_AYIN is a rolling 30-day window. Keep ordering deterministic without
    // letting calendar time age the pagination fixture out of the product query.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await publishVideo(viewer.user.channel.id, "Newest", new Date(now - day));
    await publishVideo(viewer.user.channel.id, "Middle", new Date(now - 2 * day));
    await publishVideo(viewer.user.channel.id, "Oldest", new Date(now - 29 * day));
    await publishVideo(viewer.user.channel.id, "Outside new window", new Date(now - 31 * day));

    const first = await app.inject({
      method: "GET",
      url: "/public/discovery/rows/new-on-ayin?limit=1",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(1);
    expect(first.json().items[0].title).toBe("Newest");
    expect(first.json().nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/public/discovery/rows/new-on-ayin?limit=1&cursor=${encodeURIComponent(first.json().nextCursor as string)}`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().items[0].title).toBe("Middle");
    expect(second.json().nextCursor).toBeTruthy();

    const third = await app.inject({
      method: "GET",
      url: `/public/discovery/rows/new-on-ayin?limit=1&cursor=${encodeURIComponent(second.json().nextCursor as string)}`,
    });
    expect(third.statusCode).toBe(200);
    expect(third.json().items.map((item: { title: string }) => item.title)).toEqual(["Oldest"]);
    expect(third.json().nextCursor).toBeNull();

    // The older record exists and is public, but cannot become a look-ahead item.
    const full = await app.inject({
      method: "GET",
      url: "/public/discovery/rows/new-on-ayin?limit=4",
    });
    expect(full.statusCode).toBe(200);
    expect(full.json().items.map((item: { title: string }) => item.title)).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
    expect(full.json().nextCursor).toBeNull();
  });

  it("matches authoritative policy decisions before database pagination across overrides and contexts", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const past = new Date(now.getTime() - 1);
    const future = new Date(now.getTime() + 1);
    const policies = [
      null,
      {},
      { kidsEligible: true, maturityLevel: "GENERAL" as const },
      { kidsEligible: true, maturityLevel: "TEEN" as const },
      {
        kidsEligible: true,
        maturityLevel: "GENERAL" as const,
        ageRestriction: "AGE_13_PLUS" as const,
      },
      { rightsExpiresAt: past },
      { rightsExpiresAt: now },
      { rightsExpiresAt: future },
      { allowedTerritories: ["DE"] },
      { blockedTerritories: ["DE"] },
      { allowedTerritories: ["DE"], blockedTerritories: ["DE"] },
      {
        kidsEligible: true,
        maturityLevel: "GENERAL" as const,
        rightsExpiresAt: past,
        allowedTerritories: ["US"],
      },
    ];
    const overrides = [
      null,
      ...(["FORCE_ALLOW", "FORCE_BLOCK"] as const).flatMap((disposition) =>
        [null, past, now, future].map((expiresAt) => ({ disposition, expiresAt })),
      ),
    ];
    const fixtures = policies.flatMap((policy) =>
      overrides.map((override) => {
        const videoId = randomUUID();
        return {
          videoId,
          policy:
            policy === null
              ? null
              : {
                  videoId,
                  kidsEligible: false,
                  maturityLevel: null,
                  ageRestriction: "NONE" as const,
                  rightsExpiresAt: null,
                  allowedTerritories: [] as string[],
                  blockedTerritories: [] as string[],
                  ...policy,
                },
          override: override === null ? null : { videoId, ...override },
        };
      }),
    );
    await prisma.videoPolicy.createMany({
      data: fixtures.flatMap((item) => (item.policy ? [item.policy] : [])),
    });
    await prisma.videoPolicyOverride.createMany({
      data: fixtures.flatMap((item) =>
        item.override
          ? [
              {
                ...item.override,
                actorAccountId: randomUUID(),
                reason: "Policy SQL parity fixture",
              },
            ]
          : [],
      ),
    });
    for (const isKidsProfile of [false, true]) {
      for (const countryCode of [undefined, "DE", " us ", "ZZ"]) {
        const context = { now, isKidsProfile, countryCode };
        const actual = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT candidate.id FROM unnest(ARRAY[${Prisma.join(fixtures.map((item) => Prisma.sql`${item.videoId}::uuid`))}]) AS candidate(id)
          WHERE ${availableVideoPolicySql(Prisma.sql`candidate.id`, context)}
        `);
        const expected = fixtures
          .filter((item) => evaluatePolicy(item.policy, item.override, context).allowed)
          .map((item) => item.videoId)
          .sort();
        expect(actual.map((item) => item.id).sort(), JSON.stringify(context)).toEqual(expected);
      }
    }
  });

  it("fills recent pages from policy-eligible videos before computing look-ahead", async () => {
    const viewer = await register("Policy paging", "policy-paging@example.com");
    await prisma.homeRowConfig.update({ where: { key: "new-on-ayin" }, data: { maxItems: 24 } });
    const now = Date.now();
    const visible: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const video = await publishVideo(
        viewer.user.channel.id,
        `Policy video ${i}`,
        new Date(now - i * 1000),
      );
      if (i % 3 === 2) visible.push(video.id);
      else
        await prisma.videoPolicy.create({
          data: {
            videoId: video.id,
            ...(i % 3 === 0
              ? { rightsExpiresAt: new Date(now - 60_000) }
              : { allowedTerritories: ["DE"] }),
          },
        });
    }
    const first = await app.inject({
      method: "GET",
      url: "/public/discovery/rows/new-on-ayin?limit=2",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items.map((item: { id: string }) => item.id)).toEqual(visible.slice(0, 2));
    expect(first.json().availability).toBe("AVAILABLE");
    expect(first.json().nextCursor).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/public/discovery/rows/new-on-ayin?limit=2&cursor=${first.json().nextCursor}`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items.map((item: { id: string }) => item.id)).toEqual(visible.slice(2));
    expect(second.json().nextCursor).toBeNull();
  });

  it("keeps publication and playable-media boundaries ahead of the page even with force-allow overrides", async () => {
    const viewer = await register("Public boundaries", "public-boundaries@example.com");
    const now = Date.now();
    for (let i = 0; i < 7; i += 1) {
      const video = await publishVideo(
        viewer.user.channel.id,
        `Ineligible ${i}`,
        new Date(now - i * 1000),
      );
      await prisma.videoPolicyOverride.create({
        data: {
          videoId: video.id,
          disposition: "FORCE_ALLOW",
          actorAccountId: viewer.user.account.id,
          reason: "Cannot bypass publication or media",
        },
      });
      if (i === 0)
        await prisma.video.update({ where: { id: video.id }, data: { status: "DRAFT" } });
      if (i === 1)
        await prisma.video.update({ where: { id: video.id }, data: { visibility: "UNLISTED" } });
      if (i === 2)
        await prisma.video.update({ where: { id: video.id }, data: { removedAt: new Date() } });
      if (i === 3)
        await prisma.mediaAsset.updateMany({
          where: { videoId: video.id },
          data: { removedAt: new Date() },
        });
      if (i === 4)
        await prisma.mediaAsset.updateMany({
          where: { videoId: video.id },
          data: { status: "UPLOADED" },
        });
      if (i === 5)
        await prisma.mediaAsset.updateMany({
          where: { videoId: video.id },
          data: { mimeType: "video/quicktime" },
        });
      if (i === 6) {
        const channel = await prisma.channel.create({
          data: { handle: "hidden-boundary", name: "Hidden channel", status: "HIDDEN" },
        });
        await prisma.video.update({ where: { id: video.id }, data: { channelId: channel.id } });
      }
    }
    const eligible = await publishVideo(
      viewer.user.channel.id,
      "Eligible recent",
      new Date(now - 10_000),
    );
    const oldMovie = await publishVideo(
      viewer.user.channel.id,
      "Eligible old movie",
      new Date(now - 31 * 86_400_000),
    );
    await prisma.video.update({ where: { id: oldMovie.id }, data: { contentType: "MOVIE" } });
    const recent = await app.inject({
      method: "GET",
      url: "/public/discovery/rows/new-on-ayin?limit=1",
    });
    expect(recent.statusCode).toBe(200);
    expect(recent.json().items.map((item: { id: string }) => item.id)).toEqual([eligible.id]);
    expect(recent.json().nextCursor).toBeNull();
    await prisma.homeRowConfig.update({
      where: { key: "new-on-ayin" },
      data: { source: "MOVIES" },
    });
    const movies = await app.inject({
      method: "GET",
      url: "/public/discovery/rows/new-on-ayin?limit=1",
    });
    expect(movies.statusCode).toBe(200);
    expect(movies.json().items.map((item: { id: string }) => item.id)).toEqual([oldMovie.id]);
    expect(movies.json().nextCursor).toBeNull();
  });

  it("keeps database results bounded when hundreds of newer videos are unavailable", async () => {
    const viewer = await register("Bounded paging", "bounded-paging@example.com");
    const now = Date.now();
    const videos = Array.from({ length: 515 }, (_, index) => ({
      id: randomUUID(),
      channelId: viewer.user.channel.id,
      slug: `bounded-${randomUUID()}`,
      title: `Bounded ${index}`,
      status: "PUBLISHED" as const,
      visibility: "PUBLIC" as const,
      publishedAt: new Date(now - index * 1000),
    }));
    await prisma.video.createMany({ data: videos });
    await prisma.mediaAsset.createMany({
      data: videos.map((video) => ({
        videoId: video.id,
        channelId: video.channelId,
        kind: "SOURCE_VIDEO" as const,
        status: "VALIDATED" as const,
        r2ObjectKey: `bounded/${video.id}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      })),
    });
    await prisma.videoPolicy.createMany({
      data: videos
        .slice(0, 512)
        .map((video) => ({ videoId: video.id, rightsExpiresAt: new Date(now - 60_000) })),
    });
    const database = moduleReference.get(DatabaseService).client;
    const candidateReads = vi.spyOn(database, "$queryRaw");
    const cardReads = vi.spyOn(database.video, "findMany");
    const policyReads = vi.spyOn(database.videoPolicy, "findMany");
    const overrideReads = vi.spyOn(database.videoPolicyOverride, "findMany");
    const started = performance.now();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/public/discovery/rows/new-on-ayin?limit=2",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((item: { id: string }) => item.id)).toEqual(
        videos.slice(512, 514).map((item) => item.id),
      );
      expect(response.json().nextCursor).toBeTruthy();
      expect(
        candidateReads.mock.calls.length +
          cardReads.mock.calls.length +
          policyReads.mock.calls.length +
          overrideReads.mock.calls.length,
      ).toBeLessThanOrEqual(4);
      for (const result of [...candidateReads.mock.results, ...cardReads.mock.results]) {
        if (result.type === "return") {
          const rows: unknown = await result.value;
          if (!Array.isArray(rows)) throw new Error("Expected a bounded database row result");
          expect(rows.length).toBeLessThanOrEqual(3);
        }
      }
      console.info(
        `Discovery bounded page: 515 candidates, 512 policy exclusions, ${(performance.now() - started).toFixed(1)}ms`,
      );
    } finally {
      candidateReads.mockRestore();
      cardReads.mockRestore();
      policyReads.mockRestore();
      overrideReads.mockRestore();
    }
  });

  it("reports an empty row when policy excludes all candidates", async () => {
    const viewer = await register("Unavailable row", "unavailable-row@example.com");
    for (let i = 0; i < 3; i += 1) {
      const video = await publishVideo(viewer.user.channel.id, `Unavailable ${i}`);
      await prisma.videoPolicy.create({ data: { videoId: video.id, blockedTerritories: ["DE"] } });
    }
    const response = await app.inject({
      method: "GET",
      url: "/public/discovery/rows/new-on-ayin?limit=1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [], availability: "EMPTY", nextCursor: null });
  });

  it("ends row cursors at maxItems in both home and paged responses", async () => {
    const viewer = await register("Capped row", "capped-row@example.com");
    await prisma.homeRowConfig.update({ where: { key: "new-on-ayin" }, data: { maxItems: 2 } });
    for (let i = 0; i < 4; i += 1)
      await publishVideo(viewer.user.channel.id, `Capped ${i}`, new Date(Date.now() - i * 1000));
    const home = await app.inject({ method: "GET", url: "/public/discovery/home" });
    const row = home.json().rows.find((row: { key: string }) => row.key === "new-on-ayin");
    expect(row.items).toHaveLength(2);
    expect(row.nextCursor).toBeNull();
    const first = await app.inject({
      method: "GET",
      url: "/public/discovery/rows/new-on-ayin?limit=1",
    });
    expect(first.json().nextCursor).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/public/discovery/rows/new-on-ayin?limit=1&cursor=${first.json().nextCursor}`,
    });
    expect(second.json().items).toHaveLength(1);
    expect(second.json().nextCursor).toBeNull();
  });

  it("fills Kids rows without allowing overrides to bypass classification", async () => {
    const viewer = await register("Kids paging", "kids-paging@example.com");
    const now = Date.now();
    const eligible: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const video = await publishVideo(
        viewer.user.channel.id,
        `Kids candidate ${i}`,
        new Date(now - i * 1000),
      );
      if (i >= 3) {
        await prisma.videoPolicy.create({
          data: {
            videoId: video.id,
            kidsEligible: true,
            maturityLevel: "GENERAL",
            ageRestriction: "NONE",
          },
        });
        eligible.push(video.id);
      } else {
        await prisma.videoPolicyOverride.create({
          data: {
            videoId: video.id,
            disposition: "FORCE_ALLOW",
            reason: "Cannot bypass Kids classification",
            actorAccountId: viewer.user.account.id,
          },
        });
      }
    }
    const response = await app.inject({
      method: "GET",
      url: "/public/discovery/kids/rows/new-on-ayin?limit=2",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { id: string }) => item.id)).toEqual(
      eligible.slice(0, 2),
    );
    expect(
      response.json().items.every((item: { href: string }) => item.href.endsWith("?kids=1")),
    ).toBe(true);
    expect(response.json().nextCursor).toBeTruthy();
  });

  it("builds My AYIN from the selected profile and rejects cross-account profile access", async () => {
    const owner = await register("Library Owner", "task12-owner@example.com");
    const stranger = await register("Other Viewer", "task12-other@example.com");
    const video = await publishVideo(owner.user.channel.id, "Profile-owned activity");
    const secondProfile = await prisma.viewerProfile.create({
      data: {
        accountId: owner.user.account.id,
        name: "Second profile",
        slug: "second-profile",
      },
    });
    await prisma.watchLaterItem.create({
      data: { profileId: secondProfile.id, videoId: video.id },
    });
    await prisma.myListItem.create({
      data: { profileId: secondProfile.id, videoId: video.id },
    });
    await prisma.reaction.create({
      data: { profileId: secondProfile.id, videoId: video.id, type: "LIKE" },
    });

    const library = await app.inject({
      method: "GET",
      url: `/discovery/my-ayin?profileId=${secondProfile.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(library.statusCode).toBe(200);
    const sections = Object.fromEntries(
      library
        .json()
        .sections.map((section: { key: string; items: unknown[] }) => [section.key, section]),
    ) as Record<string, { items: Array<{ title: string }>; availability: string }>;
    expect(sections["watch-later"]?.items[0]?.title).toBe("Profile-owned activity");
    expect(sections.liked?.items[0]?.title).toBe("Profile-owned activity");
    expect(sections["my-list"]?.items[0]?.title).toBe("Profile-owned activity");

    const forbidden = await app.inject({
      method: "GET",
      url: `/discovery/my-ayin?profileId=${secondProfile.id}`,
      headers: { cookie: stranger.cookie },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("uses only trusted coarse region signals and falls back to worldwide trending below the regional cohort", async () => {
    const viewer = await register("Regional Viewer", "task62-regional@example.com");
    const video = await publishVideo(viewer.user.channel.id, "Global fallback video");
    const countries = ["DE", "FR", "JP", "BR", "CA"];
    const occurredAt = new Date();
    await prisma.analyticsEvent.createMany({
      data: countries.flatMap((countryCode, index) => {
        const sessionHash = (index + 1).toString(16).padStart(64, "0");
        return [
          {
            clientEventId: `task63-global-start-${index}`,
            eventName: "VIDEO_START",
            occurredAt,
            sessionHash,
            videoId: video.id,
            metadata: { countryCode },
          },
          {
            clientEventId: `task63-global-progress-${index}`,
            eventName: "VIDEO_PROGRESS",
            occurredAt,
            sessionHash,
            videoId: video.id,
            durationDeltaMs: 10_000,
            metadata: { countryCode },
          },
        ];
      }),
    });

    const withoutSignal = await app.inject({ method: "GET", url: "/public/discovery/home" });
    expect(
      withoutSignal.json().rows.some((row: { key: string }) => row.key === "popular-region"),
    ).toBe(false);

    const untrusted = await app.inject({
      method: "GET",
      url: "/public/discovery/home",
      headers: {
        "x-ayin-region": "DE",
        "x-ayin-region-personalization": "allow",
      },
    });
    expect(untrusted.json().rows.some((row: { key: string }) => row.key === "popular-region")).toBe(
      false,
    );

    const trusted = await app.inject({
      method: "GET",
      url: "/public/discovery/home",
      headers: {
        "x-ayin-edge-token": edgeToken,
        "x-ayin-edge-country": "DE",
        "x-ayin-region-personalization": "allow",
      },
    });
    const regional = trusted
      .json()
      .rows.find((row: { key: string }) => row.key === "popular-region") as
      { title: string; availability: string; items: Array<{ title: string }> } | undefined;
    expect(regional?.title).toBe("Trending Worldwide");
    expect(regional?.availability).toBe("AVAILABLE");
    expect(regional?.items[0]?.title).toBe("Global fallback video");
  });
});
