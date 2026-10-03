import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { applyApiSecurityHeaders } from "../src/security/request-security.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const edgeToken = "public-channel-playlist-policy-edge-more-than32";
databaseDescribe(
  "Public channel and playlist share actual playback availability boundaries",
  () => {
    const prisma = createPrismaClient(databaseUrl);
    let app: NestFastifyApplication;
    const saved = new Map<string, string | undefined>();
    beforeAll(async () => {
      const environment = {
        APP_ENV: "test",
        AUTH_TOKEN_SECRET: "public-channel-playlist-test-secret-more-than32",
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: "http://localhost:3000",
        AYIN_INTERNAL_EDGE_TOKEN: edgeToken,
        AYIN_TRUST_CLOUDFLARE_REGION: "false",
      };
      for (const [key, value] of Object.entries(environment)) {
        saved.set(key, process.env[key]);
        process.env[key] = value;
      }
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
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "Account", "Channel", "PlatformSetting" CASCADE',
      );
      await prisma.videoPolicyOverride.deleteMany();
      await prisma.videoPolicy.deleteMany();
      await prisma.adminAuditLog.deleteMany();
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    async function fixture() {
      const actor = await prisma.account.create({
        data: {
          email: `public-policy-${randomUUID()}@example.test`,
          displayName: "Actual policy fixture actor",
        },
      });
      const channel = await prisma.channel.create({
        data: { name: "Actual policy channel", handle: "actual-policy-channel" },
      });
      const playlist = await prisma.playlist.create({
        data: { channelId: channel.id, slug: "actual-policy-list", name: "Actual policy list" },
      });
      return { channel, playlist, actor };
    }
    async function video(channelId: string, n: number) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      return prisma.video.create({
        data: {
          id,
          channelId,
          slug: "policy-video-" + n,
          title: "Actual policy video " + n,
          status: "PUBLISHED",
          visibility: "PUBLIC",
          publishedAt: new Date("2026-01-01T00:00:00Z"),
          createdAt: new Date("2026-01-01T00:00:00Z"),
          mediaAssets: {
            create: {
              channelId,
              kind: "SOURCE_VIDEO",
              status: "VALIDATED",
              mimeType: "video/mp4",
              sizeBytes: 1024n,
              r2ObjectKey: "policy-fixture/" + id + ".mp4",
            },
          },
        },
      });
    }
    async function item(playlistId: string, videoId: string, position: number) {
      return prisma.playlistItem.create({ data: { playlistId, videoId, position } });
    }
    function read(url: string, country = "DE", token = edgeToken) {
      return app.inject({
        url,
        headers: { "x-ayin-edge-country": country, "x-ayin-edge-token": token },
      });
    }
    function privateHeaders(response: { headers: Record<string, unknown> }) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers.pragma).toBe("no-cache");
    }
    function urls(handle: string, slug: string, kids = false) {
      const suffix = kids ? "?kids=1" : "";
      return [
        `/public/channels/${handle}${suffix}`,
        `/public/channels/${handle}/playlists/${slug}${suffix}`,
      ];
    }
    function ids(body: { videos?: { id: string }[]; items?: { video: { id: string } }[] }) {
      return body.videos?.map((v) => v.id) ?? body.items?.map((i) => i.video.id) ?? [];
    }

    it("filters over 24 newer unavailable videos BEFORE the channel limit and counts only eligible playlist items", async () => {
      const f = await fixture();
      const allowed: string[] = [];
      for (let n = 1; n <= 55; n += 1) {
        const v = await video(f.channel.id, n);
        await item(f.playlist.id, v.id, n <= 25 ? n + 100 : n - 26);
        if (n > 25) {
          await prisma.video.update({
            where: { id: v.id },
            data: { publishedAt: new Date("2026-02-01T00:00:00Z") },
          });
          await prisma.videoPolicy.create({
            data: { videoId: v.id, rightsExpiresAt: new Date("2000-01-01T00:00:00Z") },
          });
        } else allowed.unshift(v.id);
      }
      const channel = await read(urls(f.channel.handle, f.playlist.slug)[0]!);
      expect(channel.statusCode).toBe(200);
      expect(ids(channel.json())).toEqual(allowed.slice(0, 24));
      expect(channel.json().playlists).toEqual([
        expect.objectContaining({ id: f.playlist.id, itemCount: 25 }),
      ]);
      privateHeaders(channel);
      const playlist = await read(urls(f.channel.handle, f.playlist.slug)[1]!);
      expect(playlist.statusCode).toBe(200);
      expect(ids(playlist.json())).toEqual([...allowed].reverse());
      privateHeaders(playlist);
      expect(playlist.json().items.map((i: { position: number }) => i.position)).toEqual(
        Array.from({ length: 25 }, (_, n) => n + 101),
      );
      const seo = await read(`/public/seo/playlists/${f.channel.handle}/${f.playlist.slug}`);
      expect(seo.statusCode).toBe(200);
      expect(seo.json().items).toHaveLength(25);
      privateHeaders(seo);
      const seoChannel = await read(`/public/seo/channels/${f.channel.handle}`);
      expect(seoChannel.statusCode).toBe(200);
      expect(seoChannel.json()).toMatchObject({ publicVideoCount: 25, publicPlaylistCount: 1 });
      privateHeaders(seoChannel);
      expect(channel.body).not.toContain("Actual policy video 55");
      expect(playlist.body).not.toContain("Actual policy video 55");
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it("uses trusted territory and strict Kids policy consistently across gallery, item counts and playlist items", async () => {
      const f = await fixture();
      const global = await video(f.channel.id, 1),
        de = await video(f.channel.id, 2),
        teen = await video(f.channel.id, 3),
        noPolicy = await video(f.channel.id, 4);
      for (const [index, v] of [global, de, teen, noPolicy].entries())
        await item(f.playlist.id, v.id, index);
      for (const [v, data] of [
        [global, { kidsEligible: true, maturityLevel: "GENERAL" as const }],
        [
          de,
          {
            kidsEligible: true,
            maturityLevel: "GENERAL" as const,
            allowedTerritories: ["DE"] as string[],
          },
        ],
        [teen, { kidsEligible: true, maturityLevel: "TEEN" as const }],
      ] as const)
        await prisma.videoPolicy.create({ data: { videoId: v.id, ...data } });
      for (const [country, token, kids, expected] of [
        ["DE", edgeToken, false, [noPolicy.id, teen.id, de.id, global.id]],
        ["US", edgeToken, false, [noPolicy.id, teen.id, global.id]],
        ["DE", "forged", false, [noPolicy.id, teen.id, global.id]],
        ["DE", edgeToken, true, [de.id, global.id]],
        ["US", edgeToken, true, [global.id]],
        ["DE", "forged", true, [global.id]],
      ] as const) {
        for (const path of urls(f.channel.handle, f.playlist.slug, kids)) {
          const response = await read(path, country, token);
          expect(response.statusCode).toBe(200);
          expect([...ids(response.json())].sort()).toEqual([...expected].sort());
          privateHeaders(response);
          if (response.json().playlists)
            expect(response.json().playlists[0].itemCount).toBe(expected.length);
          for (const v of [global, de, teen, noPolicy])
            if (!expected.includes(v.id)) {
              expect(response.body).not.toContain(v.id);
              expect(response.body).not.toContain(v.title);
            }
        }
      }
      for (const kids of [false, true]) {
        const r = await read(`/public/seo/channels/${f.channel.handle}${kids ? "?kids=1" : ""}`);
        expect(r.statusCode).toBe(200);
        expect(r.json()).toMatchObject({ publicVideoCount: kids ? 2 : 4, publicPlaylistCount: 1 });
        privateHeaders(r);
        const us = await read(
          `/public/seo/channels/${f.channel.handle}${kids ? "?kids=1" : ""}`,
          "US",
        );
        expect(us.json().publicVideoCount).toBe(kids ? 1 : 3);
        privateHeaders(us);
      }
      const absent = await app.inject({ url: urls(f.channel.handle, f.playlist.slug)[0]! });
      expect(ids(absent.json())).not.toContain(de.id);
      privateHeaders(absent);
      const seoKids = await read(
        `/public/seo/playlists/${f.channel.handle}/${f.playlist.slug}?kids=1`,
      );
      expect(seoKids.statusCode).toBe(200);
      expect(seoKids.body).toContain(de.id);
      expect(seoKids.body).not.toContain(teen.id);
      expect(seoKids.body).not.toContain(noPolicy.id);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it("keeps hard publication/source/channel and Kids boundaries despite FORCE_ALLOW, while preserving actual authorized distribution overrides", async () => {
      const f = await fixture();
      const other = await prisma.channel.create({
        data: { name: "Unavailable owner", handle: "unavailable-owner", status: "SUSPENDED" },
      });
      const all = [];
      for (let n = 1; n <= 7; n += 1) {
        const v = await video(n === 6 ? other.id : f.channel.id, n);
        all.push(v);
        await item(f.playlist.id, v.id, n * 3);
        await prisma.videoPolicy.create({
          data: {
            videoId: v.id,
            rightsExpiresAt: new Date("2000-01-01T00:00:00Z"),
            kidsEligible: true,
            maturityLevel: n === 7 ? "TEEN" : "GENERAL",
          },
        });
        await prisma.videoPolicyOverride.create({
          data: {
            videoId: v.id,
            disposition: "FORCE_ALLOW",
            actorAccountId: f.actor.id,
            reason: "Controlled availability boundary override",
          },
        });
      }
      await prisma.video.update({ where: { id: all[1]!.id }, data: { visibility: "PRIVATE" } });
      await prisma.video.update({ where: { id: all[2]!.id }, data: { status: "DRAFT" } });
      await prisma.video.update({ where: { id: all[3]!.id }, data: { removedAt: new Date() } });
      await prisma.mediaAsset.updateMany({
        where: { videoId: all[4]!.id },
        data: { status: "UPLOADED" },
      });
      for (const kids of [false, true])
        for (const path of urls(f.channel.handle, f.playlist.slug, kids)) {
          const r = await read(path);
          expect(r.statusCode).toBe(200);
          expect([...ids(r.json())].sort()).toEqual(
            [all[0]!.id, ...(!kids ? [all[6]!.id] : [])].sort(),
          );
          privateHeaders(r);
          if (r.json().playlists) expect(r.json().playlists[0].itemCount).toBe(kids ? 1 : 2);
        }
      const kidsPlaylist = await read(urls(f.channel.handle, f.playlist.slug, true)[1]!);
      expect(kidsPlaylist.json().items[0].position).toBe(3);
    });

    it("removes newly expired rights and active FORCE_BLOCK facts on the next explicit read without stale shared caches or audit writes", async () => {
      const f = await fixture();
      const v = await video(f.channel.id, 1);
      await item(f.playlist.id, v.id, 9);
      await prisma.videoPolicy.create({
        data: { videoId: v.id, kidsEligible: true, maturityLevel: "GENERAL" },
      });
      for (const path of urls(f.channel.handle, f.playlist.slug, true))
        expect(ids((await read(path)).json())).toEqual([v.id]);
      await prisma.videoPolicy.update({
        where: { videoId: v.id },
        data: { rightsExpiresAt: new Date("2000-01-01T00:00:00Z") },
      });
      for (const path of urls(f.channel.handle, f.playlist.slug, true)) {
        const r = await read(path);
        expect(ids(r.json())).toEqual([]);
        expect(r.body).not.toContain(v.title);
        privateHeaders(r);
        if (r.json().playlists) expect(r.json().playlists[0].itemCount).toBe(0);
      }
      await prisma.videoPolicy.update({
        where: { videoId: v.id },
        data: { rightsExpiresAt: null },
      });
      await prisma.videoPolicyOverride.create({
        data: {
          videoId: v.id,
          disposition: "FORCE_BLOCK",
          actorAccountId: f.actor.id,
          reason: "Actual controlled policy block",
        },
      });
      for (const path of urls(f.channel.handle, f.playlist.slug))
        expect(ids((await read(path)).json())).toEqual([]);
      await prisma.videoPolicyOverride.update({
        where: { videoId: v.id },
        data: { expiresAt: new Date("2000-01-01T00:00:00Z") },
      });
      for (const path of urls(f.channel.handle, f.playlist.slug))
        expect(ids((await read(path)).json())).toEqual([v.id]);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it("preserves canonical handle redirects and unlisted direct reads while hiding private/deleted/inconsistent-public playlists", async () => {
      const f = await fixture();
      const v = await video(f.channel.id, 1);
      await item(f.playlist.id, v.id, 42);
      await prisma.channelHandleRedirect.create({
        data: { oldHandle: "old-policy-handle", channelId: f.channel.id },
      });
      const unlisted = await prisma.playlist.create({
        data: {
          channelId: f.channel.id,
          slug: "unlisted",
          name: "Unlisted direct",
          visibility: "UNLISTED",
          isPublic: false,
        },
      });
      await item(unlisted.id, v.id, 7);
      await expect(
        prisma.playlist.create({
          data: {
            channelId: f.channel.id,
            slug: "contradictory-private",
            name: "Must be rejected by existing database invariant",
            visibility: "PRIVATE",
            isPublic: true,
          },
        }),
      ).rejects.toMatchObject({ code: "P2039" });
      await prisma.playlist.createMany({
        data: [
          {
            channelId: f.channel.id,
            slug: "private",
            name: "Private must never appear",
            visibility: "PRIVATE",
            isPublic: false,
          },
          {
            channelId: f.channel.id,
            slug: "deleted",
            name: "Deleted must never appear",
            deletedAt: new Date(),
          },
        ],
      });
      for (const path of urls("old-policy-handle", f.playlist.slug)) {
        const r = await read(path);
        expect(r.statusCode).toBe(200);
        expect(r.json().canonicalHandle).toBe(f.channel.handle);
        expect(r.json().redirectedFrom).toBe("old-policy-handle");
        privateHeaders(r);
      }
      const channel = await read(`/public/channels/${f.channel.handle}`);
      expect(channel.json().playlists.map((p: { id: string }) => p.id)).toEqual([f.playlist.id]);
      const direct = await read(`/public/channels/${f.channel.handle}/playlists/unlisted`);
      expect(direct.statusCode).toBe(200);
      expect(direct.json().items[0].position).toBe(7);
      privateHeaders(direct);
      for (const slug of ["private", "deleted", "missing"]) {
        const r = await read(`/public/channels/${f.channel.handle}/playlists/${slug}`);
        expect(r.statusCode).toBe(404);
        expect(r.body).not.toContain(v.title);
        privateHeaders(r);
      }
      await prisma.channel.update({
        where: { id: f.channel.id },
        data: { status: "REMOVED", removedAt: new Date() },
      });
      for (const path of urls("old-policy-handle", f.playlist.slug)) {
        const r = await read(path);
        expect(r.statusCode).toBe(404);
        privateHeaders(r);
      }
    });
  },
);
