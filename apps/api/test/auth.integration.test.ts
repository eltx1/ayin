import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { Test, type TestingModule } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { CreatorProvisioningService } from "../src/auth/creator-provisioning.service.js";
import { DatabaseService } from "../src/database/database.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) {
    throw new Error("Expected a session cookie.");
  }
  return value.split(";", 1)[0] ?? value;
}

databaseDescribe("authentication and instant creator provisioning", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-03-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";

    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("creates the complete viewer and creator identity in one successful registration", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Nova Films", email: "nova@example.com", password: "strong-pass-123" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.channel.name).toBe("Nova Films");
    expect(body.user.creatorTv.name).toBe("Nova Films TV");
    expect(response.headers["set-cookie"]).toBeDefined();

    const account = await prisma.account.findUnique({
      where: { email: "nova@example.com" },
      select: { id: true, passwordHash: true },
    });
    expect(account?.passwordHash).toMatch(/^scrypt\$/);
    expect(account?.passwordHash).not.toContain("strong-pass-123");

    const membership = await prisma.channelMember.findFirst({
      where: { accountId: account?.id, role: "OWNER" },
      include: {
        channel: {
          include: {
            creatorContracts: true,
            creatorTvChannels: true,
            playlists: true,
            settings: true,
          },
        },
      },
    });
    const profiles = await prisma.viewerProfile.findMany({ where: { accountId: account?.id } });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.isDefault).toBe(true);
    expect(membership?.channel.settings).not.toBeNull();
    expect(membership?.channel.playlists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Uploads", systemKey: "UPLOADS", isProtected: true }),
      ]),
    );
    expect(membership?.channel.creatorTvChannels).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Nova Films TV" })]),
    );
    expect(membership?.channel.creatorContracts).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "PENDING" })]),
    );
    expect(membership?.channel.primaryTvChannelId).toBe(body.user.creatorTv.id);
  });

  it("keeps provisioning idempotent when the same default identity is repaired", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Repairable Creator",
        email: "repair@example.com",
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const accountId = response.json().user.account.id as string;

    const database = moduleReference.get(DatabaseService);
    const provisioning = moduleReference.get(CreatorProvisioningService);
    await database.client.$transaction((tx) =>
      provisioning.provision(tx, { accountId, displayName: "Repairable Creator" }),
    );

    expect(await prisma.viewerProfile.count({ where: { accountId } })).toBe(1);
    expect(await prisma.channelMember.count({ where: { accountId, role: "OWNER" } })).toBe(1);
    const channelId = response.json().user.channel.id as string;
    expect(await prisma.playlist.count({ where: { channelId, systemKey: "UPLOADS" } })).toBe(1);
    expect(await prisma.creatorTvChannel.count({ where: { channelId } })).toBe(1);
    expect(await prisma.channelSettings.count({ where: { channelId } })).toBe(1);
    expect(await prisma.creatorContract.count({ where: { channelId } })).toBe(1);
  });

  it("rejects duplicate email registration after normalization", async () => {
    const payload = { name: "One", email: "Owner@Example.com", password: "strong-pass-123" };
    expect((await app.inject({ method: "POST", url: "/auth/register", payload })).statusCode).toBe(
      201,
    );

    const duplicate = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...payload, email: "owner@example.com" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("EMAIL_OR_IDENTITY_CONFLICT");
  });

  it("uses the deterministic account suffix when the clean handle is already taken", async () => {
    await prisma.channel.create({ data: { handle: "collision-name", name: "Existing Channel" } });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Collision Name",
        email: "collision@example.com",
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user;
    expect(user.channel.handle).toBe(
      `collision-name-${String(user.account.id).replaceAll("-", "")}`,
    );
  });

  it("rolls back the Account and all provisioning when a late provisioning write fails", async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION task03_fail_contract() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "Channel" WHERE "id" = NEW."channelId" AND "name" = 'Rollback User') THEN
          RAISE EXCEPTION 'forced task03 provisioning failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER task03_fail_contract_trigger
      BEFORE INSERT ON "CreatorContract"
      FOR EACH ROW EXECUTE FUNCTION task03_fail_contract()
    `);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Rollback User",
          email: "rollback@example.com",
          password: "strong-pass-123",
        },
      });
      expect(response.statusCode).toBe(500);
      expect(
        await prisma.account.findUnique({ where: { email: "rollback@example.com" } }),
      ).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS task03_fail_contract_trigger ON "CreatorContract"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS task03_fail_contract()");
    }
  });

  it("supports login, logout and current-user authorization for cookie and bearer transports", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Session User", email: "session@example.com", password: "strong-pass-123" },
    });
    const registrationCookie = cookiePair(registration.headers["set-cookie"]);

    const current = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: registrationCookie },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().account.email).toBe("session@example.com");

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: registrationCookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { cookie: registrationCookie },
        })
      ).statusCode,
    ).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-ayin-auth-transport": "bearer" },
      payload: { email: "session@example.com", password: "strong-pass-123" },
    });
    expect(login.statusCode).toBe(200);
    const bearer = login.json().sessionToken as string;
    expect(bearer).toBeTruthy();

    const bearerCurrent = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(bearerCurrent.statusCode).toBe(200);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/logout",
          headers: { authorization: `Bearer ${bearer}` },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${bearer}` },
        })
      ).statusCode,
    ).toBe(401);
  });
});
