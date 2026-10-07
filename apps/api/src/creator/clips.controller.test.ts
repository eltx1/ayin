import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "../auth/auth.errors.js";
import { AuthService } from "../auth/auth.service.js";
import { OptionalAuthGuard } from "../auth/optional-auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { TrustedRegionService } from "../video-policy/trusted-region.service.js";
import { ViewerPolicyContextService } from "../video-policy/viewer-policy-context.service.js";
import { PublicClipsController } from "./clips.controller.js";
import { ClipsService } from "./clips.service.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const cookie = "ayin_session=current-session";

describe("Clips current viewer HTTP boundary", () => {
  let app: NestFastifyApplication;
  let profile: { id: string; isKids: boolean } | null;
  const findFirst = vi.fn(async () => profile);
  const authenticate = vi.fn(async () => ({ accountId, authVersion: 1, sessionId }));
  const feed = vi.fn(async (input: { isKidsProfile?: boolean }) => ({
    enabled: true,
    viewer: { isKids: input.isKidsProfile === true },
    items: [{ id: "adult-clip", mediaAssets: [{ r2ObjectKey: "private-to-adult.mp4" }] }],
    nextCursor: null,
  }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicClipsController],
      providers: [
        OptionalAuthGuard,
        ViewerPolicyContextService,
        TrustedRegionService,
        { provide: AuthService, useValue: { authenticate } },
        { provide: DatabaseService, useValue: { client: { viewerProfile: { findFirst } } } },
        { provide: ClipsService, useValue: { feed } },
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
    vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", "controlled-clips-edge-token");
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  function read(headers: Record<string, string> = {}, query = "") {
    return app.inject({ method: "GET", url: `/public/clips?take=2${query}`, headers });
  }

  it("keeps anonymous Clips public without a reusable cache", async () => {
    const response = await read();
    expect(response.statusCode).toBe(200);
    expect(response.json().viewer).toEqual({ isKids: false });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(feed).toHaveBeenCalledExactlyOnceWith({
      take: 2,
      cursor: undefined,
      countryCode: undefined,
      isKidsProfile: false,
    });
    expect(authenticate).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([{ cookie }, { authorization: "Bearer native-session" }])(
    "derives Kids from the live default before loading the feed with %o",
    async (headers) => {
      profile = { id: profileId, isKids: true };
      const response = await read(headers, `&expectedProfileId=${profileId}`);
      expect(response.statusCode).toBe(200);
      expect(response.json().viewer).toEqual({ isKids: true });
      expect(feed).toHaveBeenCalledWith(expect.objectContaining({ isKidsProfile: true }));
      expect(findFirst).toHaveBeenCalledTimes(2);
      expect(findFirst).toHaveBeenCalledWith({
        where: { accountId, isDefault: true, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, isKids: true },
      });
    },
  );

  it("accepts only trusted territory provenance", async () => {
    await read({ cookie, "cf-ipcountry": "JP", "x-ayin-country": "JP" });
    expect(feed).toHaveBeenLastCalledWith(expect.objectContaining({ countryCode: undefined }));
    await read({
      cookie,
      "x-ayin-edge-token": "controlled-clips-edge-token",
      "x-ayin-edge-country": "JP",
    });
    expect(feed).toHaveBeenLastCalledWith(expect.objectContaining({ countryCode: "JP" }));
  });

  it("preserves bearer precedence and rejects supplied invalid auth", async () => {
    expect((await read({ cookie, authorization: "Bearer native-session" })).statusCode).toBe(200);
    expect(authenticate).toHaveBeenLastCalledWith("native-session");
    feed.mockClear();
    authenticate.mockRejectedValueOnce(unauthorized());
    expect((await read({ cookie: "ayin_session=revoked" })).statusCode).toBe(401);
    expect(feed).not.toHaveBeenCalled();
    for (const authorization of ["Basic bad", "Bearer "]) {
      expect((await read({ cookie, authorization })).statusCode).toBe(401);
    }
    expect(feed).not.toHaveBeenCalled();
  });

  it.each([
    ["account", "ACCOUNT_CHANGED"],
    ["session", "SESSION_CHANGED"],
  ])("rejects a replaced expected %s before loading clips", async (kind, code) => {
    const response = await read({ cookie, [`x-ayin-expected-${kind}`]: otherId });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(code);
    expect(feed).not.toHaveBeenCalled();
  });

  it.each([{}, { cookie }])(
    "rejects foreign or unbound profile fences with %o",
    async (headers) => {
      const response = await read(headers, `&expectedProfileId=${otherId}`);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("CLIPS_VIEWER_CHANGED");
      expect(feed).not.toHaveBeenCalled();
    },
  );

  it("fails closed for a missing or deleted default", async () => {
    profile = null;
    expect((await read({ cookie })).statusCode).toBe(409);
    expect(feed).not.toHaveBeenCalled();
  });

  it.each([{ id: profileId, isKids: true }, { id: otherId, isKids: false }, null])(
    "discards a held feed after profile, audience or deletion changes: %o",
    async (replacement) => {
      feed.mockImplementationOnce(async () => {
        profile = replacement;
        return {
          enabled: true,
          viewer: { isKids: false },
          items: [{ id: "adult-clip", mediaAssets: [{ r2ObjectKey: "private-to-adult.mp4" }] }],
          nextCursor: null,
        };
      });
      const response = await read({ cookie });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("CLIPS_VIEWER_CHANGED");
      expect(response.body).not.toContain("private-to-adult");
    },
  );

  it.each([
    "&expectedProfileId=invalid",
    `&expectedProfileId=${profileId}&expectedProfileId=${otherId}`,
    "&isKidsProfile=false",
    "&kids=0",
    `&profileId=${profileId}`,
    "&take=0",
    "&cursor=invalid",
  ])("rejects malformed fences and client audience assertions: %s", async (query) => {
    const response = await read({ cookie }, query);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_CLIPS_QUERY");
    expect(feed).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
