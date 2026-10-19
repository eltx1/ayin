import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { MobilePushService } from "../src/mobile/mobile-push.service.js";
import { MobileConfigService } from "../src/mobile/mobile-config.service.js";
import { MobileDevicesService } from "../src/mobile/mobile-devices.service.js";
import { FcmHttpV1Service } from "../src/mobile/fcm-http-v1.service.js";
import {
  defaultMobileRuntimeConfig,
  mobilePreferencesSchema,
} from "../src/mobile/mobile.schemas.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
// These integration tests use real PostgreSQL + Nest auth and intentionally stub ONLY
// the external FCM transport. They do not claim SDK/device delivery evidence.
databaseDescribe("mobile runtime database and authorization integration", () => {
  const prisma = createPrismaClient(testDatabaseUrl);
  let app: NestFastifyApplication;
  const send = vi.fn().mockResolvedValue({
    accepted: true,
    code: "ACCEPTED",
    invalidToken: false,
    messageId: "projects/test/messages/test",
  });
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "mobile-runtime-integration-only-secret-at-least-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.MOBILE_PUSH_WORKER_ENABLED = "false";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FcmHttpV1Service)
      .useValue({ isConfigured: () => true, send })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.platformSetting.deleteMany({ where: { key: "mobileRuntimeConfigV1" } });
    send.mockReset().mockResolvedValue({
      accepted: true,
      code: "ACCEPTED",
      invalidToken: false,
      messageId: "projects/test/messages/test",
    });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function user(admin = false) {
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Mobile Test",
        email: `${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(result.statusCode).toBe(201);
    const value = result.headers["set-cookie"];
    let cookie = (Array.isArray(value) ? value[0]! : value!).split(";", 1)[0]!;
    const accountId = result.json().user.account.id as string;
    if (admin) {
      cookie = (await enrollTestMfa(app, cookie)).cookie;
      await prisma.adminRoleAssignment.create({ data: { accountId, role: "SUPERADMIN" } });
    }
    const token = cookie.slice(cookie.indexOf("=") + 1);
    const actor = await app.get(AuthService).authenticate(token);
    return { cookie, accountId, actor };
  }
  async function register(cookie: string, options: Record<string, unknown> = {}) {
    const payload = {
      installationId: randomUUID(),
      token: `test-fcm-${randomUUID()}`,
      platform: "android",
      appVersion: "1.0.0",
      preferences: { system: true, channel: true },
      ...options,
    };
    const result = await app.inject({
      method: "POST",
      url: "/mobile/devices",
      headers: { cookie },
      payload,
    });
    return { payload, result };
  }
  async function enable() {
    await prisma.platformSetting.create({
      data: {
        namespace: "PLATFORM",
        key: "mobileRuntimeConfigV1",
        schemaVersion: 1,
        valueType: "JSON",
        value: {
          ...defaultMobileRuntimeConfig,
          notifications: { ...defaultMobileRuntimeConfig.notifications, enabled: true },
        },
      },
    });
  }
  it("defaults integrations off and rejects unauthenticated device writes/admin reads", async () => {
    expect((await app.inject({ method: "GET", url: "/mobile/config" })).json()).toEqual(
      defaultMobileRuntimeConfig,
    );
    expect(
      (await app.inject({ method: "POST", url: "/mobile/devices", payload: {} })).statusCode,
    ).toBe(401);
    const ordinary = await user();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/admin/mobile/status",
          headers: { cookie: ordinary.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("rotates tokens, handles multiple devices, and never returns a token in device reads", async () => {
    const owner = await user();
    const first = await register(owner.cookie);
    expect(first.result.statusCode).toBe(201);
    expect((await register(owner.cookie)).result.statusCode).toBe(201);
    const rotated = await register(owner.cookie, {
      ...first.payload,
      token: `rotated-${randomUUID()}`,
    });
    expect(rotated.result.statusCode).toBe(201);
    expect(await prisma.mobileDevice.count({ where: { accountId: owner.accountId } })).toBe(2);
    const read = await app.inject({
      method: "GET",
      url: `/mobile/devices/${first.payload.installationId}`,
      headers: { cookie: owner.cookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain("token");
    expect(read.json()).toHaveProperty("preferences.system", true);
  });
  it("rejects cross-account installation/token takeover and protects delayed logout", async () => {
    const a = await user();
    const b = await user();
    const first = await register(a.cookie);
    expect((await register(b.cookie, first.payload)).result.statusCode).toBe(409);
    expect((await register(b.cookie, { token: first.payload.token })).result.statusCode).toBe(409);
    await app.inject({
      method: "DELETE",
      url: `/mobile/devices/${first.payload.installationId}`,
      headers: { cookie: b.cookie },
    });
    expect(await prisma.mobileDevice.count()).toBe(1);
    expect(
      (await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: a.cookie } }))
        .statusCode,
    ).toBe(204);
    expect(await prisma.mobileDevice.count()).toBe(0);
    expect((await register(b.cookie, first.payload)).result.statusCode).toBe(201);
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: a.cookie } });
    expect(await prisma.mobileDevice.count({ where: { accountId: b.accountId } })).toBe(1);
  });
  it("rechecks session authority after a guard would have passed", async () => {
    const owner = await user();
    await prisma.accountSession.update({
      where: { id: owner.actor.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(
      app.get(MobileDevicesService).register(owner.actor, {
        installationId: randomUUID(),
        token: `test-fcm-${randomUUID()}`,
        platform: "ios",
        appVersion: "1.0.0",
        preferences: mobilePreferencesSchema.parse({ system: true }),
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await prisma.mobileDevice.count()).toBe(0);
  });
  it("refuses config mutation after admin role revocation, with no partial audit/write", async () => {
    const admin = await user(true);
    await prisma.adminRoleAssignment.deleteMany({ where: { accountId: admin.accountId } });
    await expect(
      app
        .get(MobileConfigService)
        .update(admin.actor, defaultMobileRuntimeConfig, "Role was revoked during request"),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.platformSetting.count({ where: { key: "mobileRuntimeConfigV1" } })).toBe(0);
  });
  it("deduplicates targeted sends and honors opt-out without broadcasting", async () => {
    await enable();
    const admin = await user(true);
    const recipient = await user();
    const outsider = await user();
    const optedIn = await register(recipient.cookie);
    await register(recipient.cookie, { preferences: {} });
    await register(outsider.cookie);
    const input = {
      accountId: recipient.accountId,
      dedupeKey: randomUUID(),
      title: "Internal test",
      body: "Known test account only",
      type: "system" as const,
      destination: { kind: "notifications" as const },
      reason: "Targeted internal acceptance test",
    };
    const service = app.get(MobilePushService);
    await service.sendTargeted(admin.actor, input);
    await service.sendTargeted(admin.actor, input);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      token: optedIn.payload.token,
      accountId: recipient.accountId,
    });
    expect(await prisma.mobilePushDelivery.count({ where: { status: "SUPPRESSED" } })).toBe(1);
    const history = await service.deliveries(recipient.accountId);
    expect(JSON.stringify(history)).not.toContain(optedIn.payload.token);
  });
  it("suppresses blocked users and invalidates only provider-declared unregistered tokens", async () => {
    await enable();
    const recipient = await user();
    const sender = await user();
    await register(recipient.cookie);
    await prisma.userBlock.create({
      data: {
        blockerAccountId: recipient.accountId,
        blockedAccountId: sender.accountId,
        publicLabel: "Test sender",
      },
    });
    await prisma.notification.create({
      data: {
        accountId: recipient.accountId,
        type: "SYSTEM",
        title: "Private content never pushed",
        data: { actorAccountId: sender.accountId },
      },
    });
    await app.get(MobilePushService).tick();
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.mobilePushDelivery.count({ where: { providerCode: "USER_BLOCKED" } })).toBe(
      1,
    );
    send.mockResolvedValueOnce({ accepted: false, code: "UNREGISTERED", invalidToken: true });
    await prisma.notification.create({
      data: { accountId: recipient.accountId, type: "SYSTEM", title: "Another event" },
    });
    await app.get(MobilePushService).tick();
    expect(await prisma.mobileDevice.count()).toBe(0);
  });
  it("resolves only owned notifications and current public content destinations", async () => {
    const owner = await user();
    const other = await user();
    const notification = await prisma.notification.create({
      data: {
        accountId: owner.accountId,
        type: "VIDEO",
        title: "Unavailable video",
        data: { mobileDestination: { kind: "video", id: randomUUID() } },
      },
    });
    expect(await app.get(MobilePushService).destination(owner.accountId, notification.id)).toEqual({
      path: "/notifications",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/mobile/notifications/${notification.id}/destination`,
          headers: { cookie: other.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });
});
