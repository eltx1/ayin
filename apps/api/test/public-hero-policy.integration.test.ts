import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { defaultProductControls } from "../src/admin/admin-product-config.js";
import { AdminProductService } from "../src/admin/admin-product.service.js";
import { applyApiSecurityHeaders } from "../src/security/request-security.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const edgeToken = "public-hero-controlled-edge-token-more-than32";

databaseDescribe(
  "Public merchandising hero current availability and canonical destinations",
  () => {
    const prisma = createPrismaClient(databaseUrl);
    let app: NestFastifyApplication;

    beforeAll(async () => {
      process.env.APP_ENV = "test";
      process.env.AUTH_TOKEN_SECRET = "public-hero-test-auth-secret-more-than32";
      process.env.UPLOAD_SESSION_SECRET = "public-hero-test-upload-secret-more-than32";
      process.env.DATABASE_URL = databaseUrl;
      process.env.WEB_ORIGIN = "http://localhost:3000";
      process.env.AYIN_E2E_STORAGE = "1";
      process.env.AYIN_INTERNAL_EDGE_TOKEN = edgeToken;
      process.env.AYIN_TRUST_CLOUDFLARE_REGION = "false";
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      fastify.addHook("onRequest", async (request, reply) => {
        applyApiSecurityHeaders(reply, request);
      });
      await app.init();
      await fastify.ready();
    });

    beforeEach(async () => {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
      await prisma.platformSetting.deleteMany({
        where: { namespace: "DISCOVERY", key: "productControls" },
      });
    });

    afterAll(async () => {
      await app?.close();
      await prisma.$disconnect();
    });

    async function fixture() {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Actual hero creator",
          email: `hero-${randomUUID()}@example.test`,
          password: "strong-pass-123",
        },
      });
      expect(response.statusCode).toBe(201);
      const identity = response.json().user as {
        account: { id: string };
        profile: { id: string };
        channel: { id: string };
      };
      const header = response.headers["set-cookie"];
      const cookie = (Array.isArray(header) ? header[0] : header)!.split(";", 1)[0]!;
      const channel = await prisma.channel.findUniqueOrThrow({
        where: { id: identity.channel.id },
        include: { primaryTvChannel: true },
      });
      const video = await prisma.video.create({
        data: {
          channelId: channel.id,
          slug: `hero-video-${randomUUID()}`,
          title: "Actual featured story · حكاية أصلية",
          description: "Creator-authored description remains unchanged.",
          status: "PUBLISHED",
          visibility: "PUBLIC",
          publishedAt: new Date(),
          durationMs: 100_000,
          mediaAssets: {
            create: {
              channelId: channel.id,
              kind: "SOURCE_VIDEO",
              status: "VALIDATED",
              mimeType: "video/mp4",
              r2ObjectKey: `hero/${randomUUID()}/source.mp4`,
              sizeBytes: 1024n,
            },
          },
        },
      });
      const playlist = await prisma.playlist.create({
        data: {
          channelId: channel.id,
          slug: "actual-featured-list",
          name: "Actual featured playlist",
          visibility: "PUBLIC",
          isPublic: true,
          items: { create: { videoId: video.id, position: 0 } },
        },
      });
      return { ...identity, channel, cookie, video, playlist, tv: channel.primaryTvChannel! };
    }

    async function select(
      entityType: "VIDEO" | "CHANNEL" | "PLAYLIST" | "CREATOR_TV",
      entityId: string,
    ) {
      const value = { ...defaultProductControls, hero: { entityType, entityId } };
      await prisma.platformSetting.upsert({
        where: { namespace_key: { namespace: "DISCOVERY", key: "productControls" } },
        create: { namespace: "DISCOVERY", key: "productControls", valueType: "JSON", value },
        update: { value },
      });
    }

    function read(headers: Record<string, string> = {}, query = "") {
      return app.inject({ method: "GET", url: `/product-controls${query}`, headers });
    }

    async function expectHidden(id: string, headers: Record<string, string> = {}, query = "") {
      const response = await read(headers, query);
      expect(response.statusCode).toBe(200);
      expect(response.json().resolvedHero).toBeNull();
      expect(response.json().hero).toEqual({ entityType: null, entityId: null });
      expect(response.body).not.toContain(id);
    }

    it("returns all four canonical public destinations with unchanged authored text and reachable detail APIs", async () => {
      const f = await fixture();
      const entries = [
        ["VIDEO", f.video.id, `/watch/${f.video.slug}`, `/public/videos/${f.video.slug}/playback`],
        ["CHANNEL", f.channel.id, `/c/${f.channel.handle}`, `/public/channels/${f.channel.handle}`],
        [
          "CREATOR_TV",
          f.tv.id,
          `/c/${f.channel.handle}/tv`,
          `/public/channels/${f.channel.handle}/tv`,
        ],
        [
          "PLAYLIST",
          f.playlist.id,
          `/c/${f.channel.handle}/playlists/${f.playlist.slug}`,
          `/public/channels/${f.channel.handle}/playlists/${f.playlist.slug}`,
        ],
      ] as const;
      for (const [type, id, href, apiPath] of entries) {
        await select(type, id);
        const response = await read();
        expect(response.statusCode).toBe(200);
        expect(response.json().resolvedHero).toMatchObject({
          entityType: type,
          entityId: id,
          href,
        });
        expect((await app.inject({ method: "GET", url: apiPath })).statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(response.headers.pragma).toBe("no-cache");
      }
      await select("VIDEO", f.video.id);
      expect((await read()).json().resolvedHero).toMatchObject({
        title: f.video.title,
        description: f.video.description,
      });
    });

    it("never discloses unlisted/private, removed, draft, noncanonical or unavailable media even with FORCE_ALLOW", async () => {
      const f = await fixture();
      await select("VIDEO", f.video.id);
      await prisma.videoPolicyOverride.create({
        data: {
          videoId: f.video.id,
          disposition: "FORCE_ALLOW",
          reason: "Controlled hero boundary test",
          actorAccountId: f.account.id,
        },
      });
      for (const visibility of ["UNLISTED", "PRIVATE"] as const) {
        await prisma.video.update({ where: { id: f.video.id }, data: { visibility } });
        await expectHidden(f.video.id);
      }
      await prisma.video.update({
        where: { id: f.video.id },
        data: { visibility: "PUBLIC", removedAt: new Date() },
      });
      await expectHidden(f.video.id);
      await prisma.video.update({
        where: { id: f.video.id },
        data: { removedAt: null, status: "DRAFT" },
      });
      await expectHidden(f.video.id);
      await prisma.video.update({ where: { id: f.video.id }, data: { status: "PUBLISHED" } });
      for (const data of [
        { status: "REJECTED" as const },
        { status: "VALIDATED" as const, mimeType: "video/quicktime" },
        { mimeType: "video/mp4", removedAt: new Date() },
      ]) {
        await prisma.mediaAsset.updateMany({ where: { videoId: f.video.id }, data });
        await expectHidden(f.video.id);
      }
    });

    it("checks trusted territory without personalization permission and rechecks rights/overrides after a successful read", async () => {
      const f = await fixture();
      await select("VIDEO", f.video.id);
      await prisma.videoPolicy.create({
        data: { videoId: f.video.id, allowedTerritories: ["DE"] },
      });
      const trusted = { "x-ayin-edge-token": edgeToken, "x-ayin-edge-country": "DE" };
      expect((await read(trusted)).json().resolvedHero?.entityId).toBe(f.video.id);
      await expectHidden(f.video.id);
      await expectHidden(f.video.id, { ...trusted, "x-ayin-edge-country": "US" });
      await expectHidden(f.video.id, { ...trusted, "x-ayin-edge-token": "forged" });
      await expectHidden(f.video.id, {
        "cf-ipcountry": "DE",
        "x-ayin-region-personalization": "allow",
      });
      await prisma.videoPolicy.update({
        where: { videoId: f.video.id },
        data: { rightsExpiresAt: new Date(Date.now() - 60_000) },
      });
      await expectHidden(f.video.id, trusted);
      await prisma.videoPolicyOverride.create({
        data: {
          videoId: f.video.id,
          disposition: "FORCE_ALLOW",
          reason: "Controlled available override",
          actorAccountId: f.account.id,
        },
      });
      expect((await read(trusted)).json().resolvedHero?.entityId).toBe(f.video.id);
      await prisma.videoPolicyOverride.update({
        where: { videoId: f.video.id },
        data: { disposition: "FORCE_BLOCK" },
      });
      await expectHidden(f.video.id, trusted);
      await prisma.videoPolicyOverride.update({
        where: { videoId: f.video.id },
        data: { disposition: "FORCE_ALLOW", expiresAt: new Date(Date.now() - 1_000) },
      });
      await expectHidden(f.video.id, trusted);
    });

    it("hides every hero type after its channel is removed or suspended", async () => {
      const f = await fixture();
      for (const data of [
        { removedAt: new Date() },
        { removedAt: null, status: "SUSPENDED" as const },
      ]) {
        await prisma.channel.update({ where: { id: f.channel.id }, data });
        for (const [type, id] of [
          ["VIDEO", f.video.id],
          ["CHANNEL", f.channel.id],
          ["PLAYLIST", f.playlist.id],
          ["CREATOR_TV", f.tv.id],
        ] as const) {
          await select(type, id);
          await expectHidden(id);
        }
      }
    });

    it("requires public nondeleted playlists and current active primary TV identity", async () => {
      const f = await fixture();
      await select("PLAYLIST", f.playlist.id);
      for (const visibility of ["UNLISTED", "PRIVATE"] as const) {
        await prisma.playlist.update({
          where: { id: f.playlist.id },
          data: { visibility, isPublic: false },
        });
        await expectHidden(f.playlist.id);
      }
      await prisma.playlist.update({
        where: { id: f.playlist.id },
        data: { visibility: "PUBLIC", isPublic: true, deletedAt: new Date() },
      });
      await expectHidden(f.playlist.id);
      await select("CREATOR_TV", f.tv.id);
      for (const data of [
        { status: "DISABLED" as const },
        { status: "OFF_AIR" as const },
        { status: "ACTIVE" as const, disabledAt: new Date() },
      ]) {
        await prisma.creatorTvChannel.update({ where: { id: f.tv.id }, data });
        await expectHidden(f.tv.id);
      }
      await prisma.creatorTvChannel.update({ where: { id: f.tv.id }, data: { disabledAt: null } });
      await prisma.channel.update({
        where: { id: f.channel.id },
        data: { primaryTvChannelId: null },
      });
      await expectHidden(f.tv.id);
    });

    it("keeps canonical TV identity correct after handle changes and suppresses nonprimary siblings", async () => {
      const f = await fixture();
      await select("CREATOR_TV", f.tv.id);
      await prisma.channel.update({
        where: { id: f.channel.id },
        data: { handle: "current-hero-handle" },
      });
      expect((await read()).json().resolvedHero.href).toBe("/c/current-hero-handle/tv");
      const sibling = await prisma.creatorTvChannel.create({
        data: {
          channelId: f.channel.id,
          slug: `nonprimary-${randomUUID()}`,
          name: "Unreachable sibling TV",
        },
      });
      await select("CREATOR_TV", sibling.id);
      await expectHidden(sibling.id);
    });

    it("uses authenticated current default Kids policy and never allows a query or force-allow override to relax it", async () => {
      const f = await fixture();
      await select("VIDEO", f.video.id);
      await expectHidden(f.video.id, {}, "?kids=1");
      await prisma.viewerProfile.update({ where: { id: f.profile.id }, data: { isKids: true } });
      const headers = { cookie: f.cookie };
      await expectHidden(f.video.id, headers);
      await prisma.videoPolicyOverride.create({
        data: {
          videoId: f.video.id,
          disposition: "FORCE_ALLOW",
          reason: "Cannot bypass Kids classification",
          actorAccountId: f.account.id,
        },
      });
      await expectHidden(f.video.id, headers);
      await prisma.videoPolicy.create({
        data: {
          videoId: f.video.id,
          kidsEligible: true,
          maturityLevel: "GENERAL",
          ageRestriction: "NONE",
        },
      });
      expect((await read(headers)).json().resolvedHero.href).toBe(`/watch/${f.video.slug}?kids=1`);
      expect((await read({}, "?kids=1")).json().resolvedHero.href).toBe(
        `/watch/${f.video.slug}?kids=1`,
      );
      await prisma.videoPolicy.update({
        where: { videoId: f.video.id },
        data: { maturityLevel: "MATURE" },
      });
      await expectHidden(f.video.id, headers);
      await expectHidden(f.video.id, headers, "?kids=0");
      for (const [type, id] of [
        ["CHANNEL", f.channel.id],
        ["PLAYLIST", f.playlist.id],
        ["CREATOR_TV", f.tv.id],
      ] as const) {
        await select(type, id);
        await expectHidden(id, headers);
        await expectHidden(id, {}, "?kids=1");
      }
      await prisma.viewerProfile.update({ where: { id: f.profile.id }, data: { isKids: false } });
      expect((await read(headers)).json().resolvedHero.entityId).toBe(f.tv.id);
      await prisma.viewerProfile.update({
        where: { id: f.profile.id },
        data: { deletedAt: new Date() },
      });
      await expectHidden(f.tv.id, headers);
    });

    it("uses the explicit bearer audience instead of a conflicting cookie profile", async () => {
      const kid = await fixture();
      await prisma.viewerProfile.update({ where: { id: kid.profile.id }, data: { isKids: true } });
      const adult = await fixture();
      await select("VIDEO", adult.video.id);
      await expectHidden(adult.video.id, { cookie: kid.cookie });
      const token = decodeURIComponent(adult.cookie.slice("ayin_session=".length));
      const response = await read({ cookie: kid.cookie, authorization: `Bearer ${token}` });
      expect(response.statusCode).toBe(200);
      expect(response.json().resolvedHero.entityId).toBe(adult.video.id);
      expect(response.json().resolvedHero.href).toBe(`/watch/${adult.video.slug}`);
    });

    it("preserves bearer/cookie isolation and fails closed for malformed, stale or revoked explicit sessions", async () => {
      const f = await fixture();
      await select("VIDEO", f.video.id);
      for (const headers of [
        { cookie: "ayin_session=invalid" },
        { cookie: "ayin_session=%ZZ" },
        { cookie: "ayin_session=" },
        { authorization: "Basic ignored", cookie: f.cookie },
        { authorization: "Bearer ", cookie: f.cookie },
        { authorization: "Bearer invalid", cookie: f.cookie },
      ]) {
        const response = await read(headers);
        expect(response.statusCode).toBe(401);
        expect(response.body).not.toContain(f.video.id);
        expect(response.headers["cache-control"]).toBe("private, no-store");
      }
      await prisma.account.update({
        where: { id: f.account.id },
        data: { authVersion: { increment: 1 } },
      });
      expect((await read({ cookie: f.cookie })).statusCode).toBe(401);
      expect((await read()).json().resolvedHero.entityId).toBe(f.video.id);
    });

    it("keeps unavailable/missing IDs private but preserves the authorized Admin edit selection", async () => {
      const missing = randomUUID();
      await select("VIDEO", missing);
      await expectHidden(missing);
      expect((await app.get(AdminProductService).getAdminSnapshot()).controls.hero).toEqual({
        entityType: "VIDEO",
        entityId: missing,
      });
      expect(await prisma.adminAuditLog.count()).toBe(0);
      await prisma.platformSetting.deleteMany({
        where: { namespace: "DISCOVERY", key: "productControls" },
      });
      expect((await read()).json().resolvedHero).toBeNull();
    });
  },
);
