import "reflect-metadata";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthService } from "../auth/auth.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { MediaUploadController } from "./media-upload.controller.js";
import { MediaUploadService } from "./media-upload.service.js";
import { loadMediaStorageConfig } from "./media-storage.config.js";

function fixture(lifetimeSeconds = 900) {
  let stored: { schemaVersion: number; valueType: string; value: unknown } | null = null;
  const settingRead = vi.fn(async () => stored);
  const settings = new PlatformSettingsService({
    client: { platformSetting: { findUnique: settingRead } },
  } as never);
  const config = loadMediaStorageConfig({
    APP_ENV: "test",
    R2_UPLOAD_URL_TTL_SECONDS: String(lifetimeSeconds),
  });
  const consume = vi.fn();
  const service = new MediaUploadService(
    {} as never,
    settings,
    {} as never,
    config,
    {} as never,
    {} as never,
    { consume } as never,
  );
  return {
    service,
    settingRead,
    consume,
    store: (value: unknown) => {
      stored = { schemaVersion: 1, valueType: "INTEGER", value };
    },
  };
}

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("ordinary upload policy", () => {
  it("uses the same validated settings resolver and updates after administrator changes", async () => {
    const f = fixture(1_800);
    expect(await f.service.getUploadPolicy()).toEqual({
      maxFileSizeBytes: 5 * 1024 ** 3,
      sessionLifetimeSeconds: 1_800,
      reloadResumeSupported: false,
    });
    f.store(7 * 1024 ** 3);
    expect((await f.service.getUploadPolicy()).maxFileSizeBytes).toBe(7 * 1024 ** 3);
    f.store(-1);
    expect((await f.service.getUploadPolicy()).maxFileSizeBytes).toBe(5 * 1024 ** 3);
    expect(f.consume).not.toHaveBeenCalled();
  });

  it.each([60, 900, 3_600])(
    "reports the configured %i-second session lifetime",
    async (seconds) => {
      const f = fixture(seconds);
      expect((await f.service.getUploadPolicy()).sessionLifetimeSeconds).toBe(seconds);
    },
  );

  it("authenticates its HTTP route and returns only a private uncached policy", async () => {
    const f = fixture(1_200);
    f.store(2 * 1024 ** 3);
    const module = await Test.createTestingModule({
      controllers: [MediaUploadController],
      providers: [
        AuthGuard,
        { provide: MediaUploadService, useValue: f.service },
        {
          provide: AuthService,
          useValue: {
            authenticate: async (token: string) => {
              if (token !== "isolated-policy-fixture") throw new UnauthorizedException();
              return {
                accountId: "11111111-1111-4111-8111-111111111111",
                sessionId: "22222222-2222-4222-8222-222222222222",
                authVersion: 1,
              };
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const anonymous = await app.inject({ method: "GET", url: "/media/uploads/policy" });
    expect(anonymous.statusCode).toBe(401);
    expect(f.settingRead).not.toHaveBeenCalled();
    const response = await app.inject({
      method: "GET",
      url: "/media/uploads/policy",
      headers: { cookie: "ayin_session=isolated-policy-fixture" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({
      maxFileSizeBytes: 2 * 1024 ** 3,
      sessionLifetimeSeconds: 1_200,
      reloadResumeSupported: false,
    });
    expect(f.consume).not.toHaveBeenCalled();
  });
});
