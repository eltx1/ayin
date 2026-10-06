import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "../auth/auth.errors.js";
import { AuthService } from "../auth/auth.service.js";
import { OptionalAuthGuard } from "../auth/optional-auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { TrustedRegionService } from "../video-policy/trusted-region.service.js";
import type { VideoPolicyContext } from "../video-policy/video-policy.service.js";
import { LensSearchService } from "./lens-search.service.js";
import { SearchLanguageContextService } from "./search-language-context.service.js";
import { SearchRateLimiter } from "./search-rate-limiter.js";
import { SearchViewerContextService } from "./search-viewer-context.service.js";
import { SearchController } from "./search.controller.js";
import { SearchService } from "./search.service.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const cookie = "ayin_session=current-session";
const paths = ["", "/suggestions", "/lens", "/kids", "/kids/suggestions"];
const ordinaryPaths = ["", "/suggestions", "/lens"];
const payload = { query: "Story", items: [{ id: "private-to-adult-response" }] };

describe("Search current viewer HTTP boundary", () => {
  let app: NestFastifyApplication;
  let profile: { id: string; isKids: boolean } | null;
  const findFirst = vi.fn(async () => profile);
  const authenticate = vi.fn(async () => ({ accountId, authVersion: 1, sessionId }));
  const operation = vi
    .fn<(context: VideoPolicyContext) => Promise<typeof payload>>()
    .mockResolvedValue(payload);
  const search = vi.fn(
    async (_q: string, _cursor: string | undefined, _limit: number, context: VideoPolicyContext) =>
      operation(context),
  );
  const suggest = vi.fn(async (_q: string, _limit: number, context: VideoPolicyContext) =>
    operation(context),
  );

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        OptionalAuthGuard,
        SearchViewerContextService,
        SearchLanguageContextService,
        TrustedRegionService,
        { provide: AuthService, useValue: { authenticate } },
        { provide: DatabaseService, useValue: { client: { viewerProfile: { findFirst } } } },
        { provide: SearchService, useValue: { search, suggest } },
        { provide: LensSearchService, useValue: { searchLens: suggest } },
        { provide: SearchRateLimiter, useValue: { consume: vi.fn() } },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    profile = { id: profileId, isKids: false };
    vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "false");
    vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", "controlled-search-edge-token");
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  function read(path: string, headers: Record<string, string> = {}, query = "") {
    return app.inject({
      method: "GET",
      url: `/public/search${path}?q=Story${query}`,
      headers,
    });
  }

  it.each(paths)("keeps anonymous %s public and explicit Kids routes restrictive", async (path) => {
    const response = await read(path);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(payload);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(operation).toHaveBeenCalledExactlyOnceWith({
      countryCode: undefined,
      isKidsProfile: path.startsWith("/kids"),
    });
    expect(authenticate).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each(paths)("resolves authenticated %s from the live owned default profile", async (path) => {
    const response = await read(
      path,
      { cookie, "x-ayin-expected-account": accountId },
      `&expectedProfileId=${profileId}`,
    );
    expect(response.statusCode).toBe(200);
    expect(authenticate).toHaveBeenCalledExactlyOnceWith("current-session");
    expect(operation).toHaveBeenCalledExactlyOnceWith({
      countryCode: undefined,
      isKidsProfile: path.startsWith("/kids"),
    });
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledWith({
      where: { accountId, isDefault: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, isKids: true },
    });
  });

  it.each(ordinaryPaths)("enforces authenticated Kids policy through ordinary %s", async (path) => {
    profile = { id: profileId, isKids: true };
    const response = await read(path, { cookie });
    expect(response.statusCode).toBe(200);
    expect(operation).toHaveBeenCalledExactlyOnceWith({
      countryCode: undefined,
      isKidsProfile: true,
    });
  });

  it("retains trusted territory and ignores forged viewer country headers", async () => {
    await read("", { cookie, "cf-ipcountry": "DE", "x-ayin-country": "DE" });
    expect(operation).toHaveBeenLastCalledWith({
      countryCode: undefined,
      isKidsProfile: false,
    });
    await read("/suggestions", {
      cookie,
      "x-ayin-edge-token": "controlled-search-edge-token",
      "x-ayin-edge-country": "DE",
    });
    expect(operation).toHaveBeenLastCalledWith({ countryCode: "DE", isKidsProfile: false });
  });

  it.each(paths)("rejects an invalid supplied session before %s", async (path) => {
    authenticate.mockRejectedValueOnce(unauthorized());
    const response = await read(path, { cookie: "ayin_session=revoked" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
    expect(operation).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("preserves bearer precedence and expected-account/session fences", async () => {
    expect((await read("", { cookie, authorization: "Bearer actual-bearer" })).statusCode).toBe(
      200,
    );
    expect(authenticate).toHaveBeenLastCalledWith("actual-bearer");
    for (const [header, code] of [
      ["x-ayin-expected-account", "ACCOUNT_CHANGED"],
      ["x-ayin-expected-session", "SESSION_CHANGED"],
    ] as const) {
      operation.mockClear();
      const response = await read("", { cookie, [header]: otherId });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe(code);
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it.each(paths)("rejects foreign or stale expected profiles on %s", async (path) => {
    const response = await read(path, { cookie }, `&expectedProfileId=${otherId}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SEARCH_VIEWER_CHANGED");
    expect(operation).not.toHaveBeenCalled();
  });

  it.each(paths)("requires authentication for a profile-bound %s", async (path) => {
    const response = await read(path, {}, `&expectedProfileId=${profileId}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SEARCH_VIEWER_CHANGED");
    expect(operation).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each(paths)("fails closed for a missing or deleted default on %s", async (path) => {
    profile = null;
    const response = await read(path, { cookie });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SEARCH_VIEWER_CHANGED");
    expect(operation).not.toHaveBeenCalled();
  });

  it.each(paths)(
    "rejects a changed audience/default/deletion before releasing %s",
    async (path) => {
      for (const replacement of [
        { id: profileId, isKids: true },
        { id: otherId, isKids: false },
        null,
      ]) {
        profile = { id: profileId, isKids: false };
        operation.mockImplementationOnce(async () => {
          profile = replacement;
          return payload;
        });
        const response = await read(path, { cookie });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("SEARCH_VIEWER_CHANGED");
        expect(response.body).not.toContain("private-to-adult-response");
      }
    },
  );

  it.each(paths)(
    "validates the profile fence and rejects audience assertions on %s",
    async (path) => {
      for (const query of [
        "&expectedProfileId=invalid",
        "&isKidsProfile=false",
        `&profileId=${profileId}`,
      ]) {
        const response = await read(path, { cookie }, query);
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("INVALID_SEARCH_QUERY");
      }
      expect(operation).not.toHaveBeenCalled();
    },
  );
});
