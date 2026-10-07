import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "../auth/auth.errors.js";
import { AuthService } from "../auth/auth.service.js";
import { OptionalAuthGuard } from "../auth/optional-auth.guard.js";
import { CatalogLocalizationService } from "../catalog-localization/catalog-localization.service.js";
import { DatabaseService } from "../database/database.service.js";
import { TrustedRegionService } from "../video-policy/trusted-region.service.js";
import { ViewerPolicyContextService } from "../video-policy/viewer-policy-context.service.js";
import { PublicWatchController } from "./watch.controller.js";
import { WatchError, WatchService } from "./watch.service.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const cookie = "ayin_session=current-session";
const payload = {
  video: { id: "video", source: { objectKey: "private-to-authorized-viewer.mp4" } },
  detail: { seriesContext: null },
};
const mediaSelection = { sourceAssetId: "source-asset", generationId: null };

describe("playback current viewer HTTP boundary", () => {
  let app: NestFastifyApplication;
  let profile: { id: string; isKids: boolean } | null;
  const findFirst = vi.fn(async () => profile);
  const authenticate = vi.fn(async () => ({ accountId, authVersion: 1, sessionId }));
  const getPublicPlayback = vi
    .fn<
      (
        slug: string,
        country: string | undefined,
        isKids: boolean,
      ) => Promise<typeof payload & { mediaSelection: typeof mediaSelection }>
    >()
    .mockResolvedValue({ ...payload, mediaSelection });
  const assertPlaybackStillAvailable = vi.fn(async () => undefined);
  const localizeSeriesContext = vi.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicWatchController],
      providers: [
        OptionalAuthGuard,
        ViewerPolicyContextService,
        TrustedRegionService,
        { provide: AuthService, useValue: { authenticate } },
        { provide: DatabaseService, useValue: { client: { viewerProfile: { findFirst } } } },
        { provide: WatchService, useValue: { getPublicPlayback, assertPlaybackStillAvailable } },
        { provide: CatalogLocalizationService, useValue: { localizeSeriesContext } },
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
    vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", "controlled-playback-edge-token");
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  function read(headers: Record<string, string> = {}, query = "") {
    return app.inject({ method: "GET", url: `/public/videos/story/playback${query}`, headers });
  }

  it.each([false, true])(
    "keeps anonymous playback public and explicit Kids restrictive (%s)",
    async (kids) => {
      const response = await read({}, kids ? "?kids=1" : "");
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ...payload, viewer: { isKids: kids } });
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(getPublicPlayback).toHaveBeenCalledExactlyOnceWith("story", undefined, kids);
      expect(assertPlaybackStillAvailable).toHaveBeenCalledExactlyOnceWith(
        payload.video,
        mediaSelection,
        undefined,
        kids,
      );
      expect(authenticate).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([{ cookie }, { authorization: "Bearer native-session" }])(
    "enforces Kids on ordinary playback with current transport %o",
    async (headers) => {
      profile = { id: profileId, isKids: true };
      const response = await read(
        headers,
        `?expectedProfileId=${profileId}&isKidsProfile=false&kids=0`,
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().viewer).toEqual({ isKids: true });
      expect(getPublicPlayback).toHaveBeenCalledExactlyOnceWith("story", undefined, true);
      expect(findFirst).toHaveBeenCalledTimes(2);
      expect(findFirst).toHaveBeenCalledWith({
        where: { accountId, isDefault: true, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, isKids: true },
      });
    },
  );

  it("retains trusted territory and ignores forged viewer region", async () => {
    await read({ cookie, "cf-ipcountry": "JP", "x-ayin-country": "JP" });
    expect(getPublicPlayback).toHaveBeenLastCalledWith("story", undefined, false);
    await read({
      cookie,
      "x-ayin-edge-token": "controlled-playback-edge-token",
      "x-ayin-edge-country": "JP",
    });
    expect(getPublicPlayback).toHaveBeenLastCalledWith("story", "JP", false);
    expect(assertPlaybackStillAvailable).toHaveBeenLastCalledWith(
      payload.video,
      mediaSelection,
      "JP",
      false,
    );
  });

  it("rejects invalid supplied auth and preserves bearer precedence", async () => {
    await read({ cookie, authorization: "Bearer native-session" });
    expect(authenticate).toHaveBeenLastCalledWith("native-session");
    getPublicPlayback.mockClear();
    authenticate.mockRejectedValueOnce(unauthorized());
    const response = await read({ cookie: "ayin_session=revoked" });
    expect(response.statusCode).toBe(401);
    expect(getPublicPlayback).not.toHaveBeenCalled();
  });

  it.each(["account", "session"])(
    "rejects a replaced expected %s before loading media",
    async (kind) => {
      const response = await read({ cookie, [`x-ayin-expected-${kind}`]: otherId });
      expect(response.statusCode).toBe(409);
      expect(getPublicPlayback).not.toHaveBeenCalled();
      expect(response.body).not.toContain("private-to-authorized-viewer");
    },
  );

  it.each([{}, { cookie }])("rejects unbound or foreign expected profiles %o", async (headers) => {
    const response = await read(headers, `?expectedProfileId=${otherId}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PLAYBACK_VIEWER_CHANGED");
    expect(getPublicPlayback).not.toHaveBeenCalled();
  });

  it("fails closed for a deleted or missing default", async () => {
    profile = null;
    const response = await read({ cookie });
    expect(response.statusCode).toBe(409);
    expect(getPublicPlayback).not.toHaveBeenCalled();
  });

  it.each([{ id: profileId, isKids: true }, { id: otherId, isKids: false }, null])(
    "discards a held source after profile/policy change %o",
    async (replacement) => {
      assertPlaybackStillAvailable.mockImplementationOnce(async () => {
        profile = replacement;
      });
      const response = await read({ cookie });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("PLAYBACK_VIEWER_CHANGED");
      expect(response.body).not.toContain("private-to-authorized-viewer");
    },
  );

  it("does not release prepared source after final content-policy rejection", async () => {
    assertPlaybackStillAvailable.mockRejectedValueOnce(
      new WatchError("VIDEO_NOT_FOUND", "Unavailable", 404),
    );
    const response = await read({ cookie });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("private-to-authorized-viewer");
  });

  it.each(["invalid", [profileId, otherId], { id: profileId }])(
    "validates expected-profile shape before loading %o",
    async (expectedProfileId) => {
      await expect(
        app.get(PublicWatchController).playback({}, "story", { expectedProfileId }, {}),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: { code: "INVALID_PLAYBACK_QUERY" } },
      });
      expect(getPublicPlayback).not.toHaveBeenCalled();
    },
  );
});
