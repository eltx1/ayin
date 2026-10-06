import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { SearchService } from "../src/search/search.service.js";
import { applyApiSecurityHeaders } from "../src/security/request-security.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const edgeToken = "search-viewer-policy-controlled-edge-token-more-than32";
const paths = ["", "/suggestions", "/lens", "/kids", "/kids/suggestions"];
const ordinaryPaths = ["", "/suggestions", "/lens"];

type Identity = {
  account: { id: string };
  profile: { id: string };
  channel: { id: string };
  cookie: string;
};

databaseDescribe("Search authenticated current viewer policy on PostgreSQL", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  let viewer: Identity;
  let foreign: Identity;
  let otherProfileId: string;
  let safeId: string;
  let adultId: string;
  let restrictedId: string;
  const query = `Searchscope${randomUUID().replaceAll("-", "").slice(0, 10)}`;

  beforeAll(async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("AUTH_TOKEN_SECRET", "search-viewer-policy-test-secret-more-than32");
    vi.stubEnv("UPLOAD_SESSION_SECRET", "search-viewer-upload-test-secret-more-than32");
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

    viewer = await register("Search viewer");
    foreign = await register("Other search viewer");
    otherProfileId = (
      await prisma.viewerProfile.create({
        data: { accountId: viewer.account.id, name: "Other adult", slug: "other-adult" },
      })
    ).id;
    await prisma.channel.update({
      where: { id: viewer.channel.id },
      data: { name: `${query} creator` },
    });
    safeId = await video("safe", true);
    adultId = await video("adult", false);
    restrictedId = await video("restricted", true, ["DE"]);
  }, 30_000);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.viewerProfile.updateMany({
      where: { accountId: viewer.account.id },
      data: { isDefault: false, isKids: false, deletedAt: null },
    });
    await prisma.viewerProfile.update({
      where: { id: viewer.profile.id },
      data: { isDefault: true },
    });
    await prisma.accountSession.updateMany({
      where: { accountId: { in: [viewer.account.id, foreign.account.id] } },
      data: { revokedAt: null },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    const identities = [viewer, foreign].filter(Boolean);
    const channelIds = identities.map((identity) => identity.channel.id);
    await prisma.video.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.creatorContract.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.channel.deleteMany({
      where: { id: { in: channelIds } },
    });
    await prisma.account.deleteMany({
      where: { id: { in: identities.map((identity) => identity.account.id) } },
    });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  async function register(name: string): Promise<Identity> {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name, email: `search-${randomUUID()}@example.test`, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    const header = response.headers["set-cookie"];
    return {
      ...response.json().user,
      cookie: (Array.isArray(header) ? header[0] : header)!.split(";", 1)[0]!,
    };
  }

  async function video(label: string, kidsEligible: boolean, allowedTerritories: string[] = []) {
    const created = await prisma.video.create({
      data: {
        channelId: viewer.channel.id,
        slug: `${label}-${randomUUID()}`,
        title: `${query} ${label}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
        durationMs: 100_000,
        mediaAssets: {
          create: {
            channelId: viewer.channel.id,
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            mimeType: "video/mp4",
            r2ObjectKey: `search-viewer-policy/${randomUUID()}.mp4`,
            sizeBytes: 1024n,
          },
        },
      },
    });
    await prisma.videoPolicy.create({
      data: {
        videoId: created.id,
        kidsEligible,
        maturityLevel: kidsEligible ? "GENERAL" : "MATURE",
        ageRestriction: kidsEligible ? "NONE" : "AGE_18_PLUS",
        allowedTerritories,
      },
    });
    return created.id;
  }

  function read(path: string, headers: Record<string, string> = {}, suffix = "") {
    return app.inject({
      method: "GET",
      url: `/public/search${path}?q=${query}${suffix}`,
      headers,
    });
  }

  async function expectKids(path: string, headers: Record<string, string> = {}) {
    const response = await read(path, headers);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const body = response.json();
    const results = (body.suggestions ?? body.items) as Array<{
      id: string;
      type: string;
      href: string;
    }>;
    expect(results.map((item) => item.id)).toEqual([safeId]);
    expect(results.every((item) => item.type === "VIDEO" && item.href.endsWith("?kids=1"))).toBe(
      true,
    );
    expect(response.body).not.toContain(adultId);
    expect(response.body).not.toContain(restrictedId);
  }

  it.each(ordinaryPaths)("preserves anonymous/adult results on %s", async (path) => {
    for (const headers of [{}, { cookie: viewer.cookie }]) {
      const response = await read(path, headers);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(safeId);
      expect(response.body).toContain(adultId);
      expect(response.body).not.toContain(restrictedId);
    }
  });

  it.each(ordinaryPaths)(
    "filters adult results for an authenticated Kids default on %s",
    async (path) => {
      await prisma.viewerProfile.update({
        where: { id: viewer.profile.id },
        data: { isKids: true },
      });
      await expectKids(path, { cookie: viewer.cookie });
      await prisma.viewerProfile.update({
        where: { id: viewer.profile.id },
        data: { isKids: false },
      });
      expect((await read(path, { cookie: viewer.cookie })).body).toContain(adultId);
    },
  );

  it.each(["/kids", "/kids/suggestions"])(
    "keeps %s restrictive for anonymous and adult viewers",
    async (path) => {
      await expectKids(path);
      await expectKids(path, { cookie: viewer.cookie });
    },
  );

  it("continues enforcing trusted region for authenticated reads", async () => {
    const trusted = {
      cookie: viewer.cookie,
      "x-ayin-edge-token": edgeToken,
      "x-ayin-edge-country": "DE",
    };
    for (const path of paths) {
      expect((await read(path, trusted)).body).toContain(restrictedId);
      expect((await read(path, { ...trusted, "x-ayin-edge-token": "forged" })).body).not.toContain(
        restrictedId,
      );
    }
  });

  it("binds expected profiles to the current default without allowing foreign or nondefault selection", async () => {
    for (const path of paths) {
      expect(
        (await read(path, { cookie: viewer.cookie }, `&expectedProfileId=${viewer.profile.id}`))
          .statusCode,
      ).toBe(200);
      for (const expectedProfileId of [foreign.profile.id, otherProfileId]) {
        const response = await read(
          path,
          { cookie: viewer.cookie },
          `&expectedProfileId=${expectedProfileId}`,
        );
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("SEARCH_VIEWER_CHANGED");
      }
      expect((await read(path, {}, `&expectedProfileId=${viewer.profile.id}`)).statusCode).toBe(
        409,
      );
    }
  });

  it("fails closed when the default is deleted or no longer exists and rejects stale profile leases", async () => {
    for (const data of [{ deletedAt: new Date() }, { deletedAt: null, isDefault: false }]) {
      await prisma.viewerProfile.update({ where: { id: viewer.profile.id }, data });
      for (const path of paths) {
        const response = await read(path, { cookie: viewer.cookie });
        expect(response.statusCode).toBe(409);
        expect(response.body).not.toContain(adultId);
      }
    }
    await prisma.viewerProfile.update({ where: { id: otherProfileId }, data: { isDefault: true } });
    for (const path of paths) {
      const stale = await read(
        path,
        { cookie: viewer.cookie },
        `&expectedProfileId=${viewer.profile.id}`,
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("SEARCH_VIEWER_CHANGED");
      expect(
        (await read(path, { cookie: viewer.cookie }, `&expectedProfileId=${otherProfileId}`))
          .statusCode,
      ).toBe(200);
    }
  });

  it("rejects invalid/revoked sessions and preserves bearer ownership over conflicting cookies", async () => {
    for (const headers of [
      { cookie: "ayin_session=malformed" },
      { cookie: viewer.cookie, authorization: "Basic unsupported" },
    ]) {
      for (const path of paths) expect((await read(path, headers)).statusCode).toBe(401);
    }
    await prisma.viewerProfile.update({
      where: { id: foreign.profile.id },
      data: { isKids: true },
    });
    const token = decodeURIComponent(foreign.cookie.slice("ayin_session=".length));
    await expectKids("/suggestions", { cookie: viewer.cookie, authorization: `Bearer ${token}` });
    await prisma.accountSession.updateMany({
      where: { accountId: viewer.account.id },
      data: { revokedAt: new Date() },
    });
    for (const path of paths)
      expect((await read(path, { cookie: viewer.cookie })).statusCode).toBe(401);
  });

  it.each(paths)(
    "withholds %s when the actual profile changes after search finishes",
    async (path) => {
      const service = app.get(SearchService);
      for (const data of [{ isKids: true }, { deletedAt: new Date() }, { isDefault: false }]) {
        await prisma.viewerProfile.update({
          where: { id: viewer.profile.id },
          data: { isKids: false, deletedAt: null, isDefault: true },
        });
        if (path.endsWith("suggestions")) {
          const original = service.suggest.bind(service);
          vi.spyOn(service, "suggest").mockImplementationOnce(async (...args) => {
            const result = await original(...args);
            await prisma.viewerProfile.update({ where: { id: viewer.profile.id }, data });
            return result;
          });
        } else {
          const original = service.search.bind(service);
          vi.spyOn(service, "search").mockImplementationOnce(async (...args) => {
            const result = await original(...args);
            await prisma.viewerProfile.update({ where: { id: viewer.profile.id }, data });
            return result;
          });
        }
        const response = await read(path, { cookie: viewer.cookie });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("SEARCH_VIEWER_CHANGED");
        expect(response.body).not.toContain(adultId);
        vi.restoreAllMocks();
      }
    },
  );
});
