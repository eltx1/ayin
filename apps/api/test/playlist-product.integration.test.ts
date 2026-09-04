import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { PlaylistService } from "../src/creator/playlist.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

databaseDescribe("Task 09 playlist product", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-09-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";

    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "AdminRoleAssignment", "PlatformSetting", "Account", "Channel" CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register(name: string, email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name, email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    return { cookie: cookiePair(response.headers["set-cookie"]), user: response.json().user };
  }

  async function publishedVideo(
    channelId: string,
    title: string,
    visibility: "PUBLIC" | "UNLISTED" | "PRIVATE" = "PUBLIC",
    assetStatus: "UPLOADED" | "VALIDATED" = "VALIDATED",
  ) {
    const id = randomUUID();
    const video = await prisma.video.create({
      data: {
        id,
        channelId,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 8)}`,
        title,
        status: "PUBLISHED",
        visibility,
        publishedAt: new Date(),
      },
    });
    await prisma.mediaAsset.create({
      data: {
        id: randomUUID(),
        channelId,
        videoId: id,
        kind: "SOURCE_VIDEO",
        status: assetStatus,
        r2ObjectKey: `channels/${channelId}/media/${id}/${assetStatus.toLowerCase()}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      },
    });
    return video;
  }

  async function createPlaylist(
    cookie: string,
    channelId: string,
    name: string,
    visibility: "PUBLIC" | "UNLISTED" | "PRIVATE" = "PUBLIC",
  ) {
    const response = await app.inject({
      method: "POST",
      url: `/creator/channels/${channelId}/playlists`,
      headers: { cookie },
      payload: { name, visibility },
    });
    expect(response.statusCode).toBe(201);
    return response.json().playlist as { id: string; slug: string; name: string };
  }

  it("protects Uploads and follows the creator rename policy while preserving admin override", async () => {
    const owner = await register("Playlist Owner", "playlist-owner@example.com");
    const listed = await app.inject({
      method: "GET",
      url: `/creator/channels/${owner.user.channel.id}/playlists`,
      headers: { cookie: owner.cookie },
    });
    expect(listed.statusCode).toBe(200);
    const uploads = listed
      .json()
      .playlists.find((playlist: { systemKey: string | null }) => playlist.systemKey === "UPLOADS");
    expect(uploads).toBeTruthy();
    expect(uploads.capabilities.canDelete).toBe(false);
    expect(uploads.capabilities.canEditItems).toBe(false);

    const deletion = await app.inject({
      method: "DELETE",
      url: `/creator/playlists/${uploads.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(deletion.statusCode).toBe(409);
    expect(deletion.json().error.code).toBe("SYSTEM_PLAYLIST_PROTECTED");

    const video = await publishedVideo(owner.user.channel.id, "Protected Upload");
    const manualAdd = await app.inject({
      method: "POST",
      url: `/creator/playlists/${uploads.id}/items`,
      headers: { cookie: owner.cookie },
      payload: { videoId: video.id },
    });
    expect(manualAdd.statusCode).toBe(409);
    expect(manualAdd.json().error.code).toBe("SYSTEM_PLAYLIST_ITEMS_PROTECTED");

    await prisma.platformSetting.create({
      data: {
        namespace: "CREATOR",
        key: "allowCreatorUploadsPlaylistRename",
        valueType: "BOOLEAN",
        value: false,
        description: "test policy",
      },
    });
    const ownerRename = await app.inject({
      method: "PATCH",
      url: `/creator/playlists/${uploads.id}`,
      headers: { cookie: owner.cookie },
      payload: { name: "My Library" },
    });
    expect(ownerRename.statusCode).toBe(409);
    expect(ownerRename.json().error.code).toBe("UPLOADS_RENAME_DISABLED");

    const admin = await register("Playlist Admin", "playlist-admin@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: admin.user.account.id, role: "ADMIN" },
    });
    const service = moduleReference.get(PlaylistService);
    await service.updatePlaylist({ kind: "admin", accountId: admin.user.account.id }, uploads.id, {
      name: "Admin Library",
    });
    const renamed = await prisma.playlist.findUnique({ where: { id: uploads.id } });
    expect(renamed?.name).toBe("Admin Library");
    expect(await prisma.adminAuditLog.count({ where: { entityId: uploads.id } })).toBe(1);
  });

  it("prevents duplicates and keeps add, reorder and remove positions gapless", async () => {
    const owner = await register("Ordering Owner", "ordering-owner@example.com");
    const playlist = await createPlaylist(owner.cookie, owner.user.channel.id, "Ordered Picks");
    const videos = await Promise.all([
      publishedVideo(owner.user.channel.id, "Alpha"),
      publishedVideo(owner.user.channel.id, "Beta"),
      publishedVideo(owner.user.channel.id, "Gamma"),
    ]);

    for (const video of videos) {
      const added = await app.inject({
        method: "POST",
        url: `/creator/playlists/${playlist.id}/items`,
        headers: { cookie: owner.cookie },
        payload: { videoId: video.id },
      });
      expect(added.statusCode).toBe(201);
      expect(added.json().alreadyPresent).toBe(false);
    }
    const duplicate = await app.inject({
      method: "POST",
      url: `/creator/playlists/${playlist.id}/items`,
      headers: { cookie: owner.cookie },
      payload: { videoId: videos[1]!.id },
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json().alreadyPresent).toBe(true);
    expect(await prisma.playlistItem.count({ where: { playlistId: playlist.id } })).toBe(3);

    const initial = await app.inject({
      method: "GET",
      url: `/creator/playlists/${playlist.id}`,
      headers: { cookie: owner.cookie },
    });
    const initialItems = initial.json().items as Array<{
      id: string;
      position: number;
      video: { title: string };
    }>;
    expect(initialItems.map((item) => item.video.title)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(initialItems.map((item) => item.position)).toEqual([0, 1, 2]);

    const reorderedIds = [initialItems[2]!.id, initialItems[0]!.id, initialItems[1]!.id];
    const reordered = await app.inject({
      method: "PUT",
      url: `/creator/playlists/${playlist.id}/items/reorder`,
      headers: { cookie: owner.cookie },
      payload: { itemIds: reorderedIds },
    });
    expect(reordered.statusCode).toBe(200);

    const afterReorder = await app.inject({
      method: "GET",
      url: `/creator/playlists/${playlist.id}`,
      headers: { cookie: owner.cookie },
    });
    const reorderedItems = afterReorder.json().items as Array<{
      id: string;
      position: number;
      video: { title: string };
    }>;
    expect(reorderedItems.map((item) => item.video.title)).toEqual(["Gamma", "Alpha", "Beta"]);

    const removed = await app.inject({
      method: "DELETE",
      url: `/creator/playlists/${playlist.id}/items/${reorderedItems[1]!.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(removed.statusCode).toBe(200);
    const remaining = await prisma.playlistItem.findMany({
      where: { playlistId: playlist.id },
      orderBy: { position: "asc" },
      include: { video: true },
    });
    expect(remaining.map((item) => item.video.title)).toEqual(["Gamma", "Beta"]);
    expect(remaining.map((item) => item.position)).toEqual([0, 1]);
  });

  it("enforces channel ownership for playlist management", async () => {
    const owner = await register("Actual Owner", "actual-owner@example.com");
    const other = await register("Other Owner", "other-owner@example.com");
    const playlist = await createPlaylist(owner.cookie, owner.user.channel.id, "Owner Only");
    const video = await publishedVideo(owner.user.channel.id, "Owner Video");

    const read = await app.inject({
      method: "GET",
      url: `/creator/playlists/${playlist.id}`,
      headers: { cookie: other.cookie },
    });
    expect(read.statusCode).toBe(403);
    expect(read.json().error.code).toBe("PLAYLIST_OWNER_REQUIRED");

    const add = await app.inject({
      method: "POST",
      url: `/creator/playlists/${playlist.id}/items`,
      headers: { cookie: other.cookie },
      payload: { videoId: video.id },
    });
    expect(add.statusCode).toBe(403);

    const createOnOtherChannel = await app.inject({
      method: "POST",
      url: `/creator/channels/${owner.user.channel.id}/playlists`,
      headers: { cookie: other.cookie },
      payload: { name: "Not Mine" },
    });
    expect(createOnOtherChannel.statusCode).toBe(403);
  });

  it("supports public and unlisted links without exposing private playlists or private videos", async () => {
    const owner = await register("Visibility Owner", "visibility-owner@example.com");
    const publicPlaylist = await createPlaylist(
      owner.cookie,
      owner.user.channel.id,
      "Public Picks",
      "PUBLIC",
    );
    const unlistedPlaylist = await createPlaylist(
      owner.cookie,
      owner.user.channel.id,
      "Secret Link",
      "UNLISTED",
    );
    const privatePlaylist = await createPlaylist(
      owner.cookie,
      owner.user.channel.id,
      "Private Picks",
      "PRIVATE",
    );
    const publicVideo = await publishedVideo(owner.user.channel.id, "Public Video", "PUBLIC");
    const privateVideo = await publishedVideo(owner.user.channel.id, "Private Video", "PRIVATE");
    const rawVideo = await publishedVideo(
      owner.user.channel.id,
      "Still Processing",
      "PUBLIC",
      "UPLOADED",
    );

    for (const video of [publicVideo, privateVideo, rawVideo]) {
      const added = await app.inject({
        method: "POST",
        url: `/creator/playlists/${publicPlaylist.id}/items`,
        headers: { cookie: owner.cookie },
        payload: { videoId: video.id },
      });
      expect(added.statusCode).toBe(201);
    }

    for (const playlist of [publicPlaylist, unlistedPlaylist, privatePlaylist]) {
      const video = await publishedVideo(owner.user.channel.id, `Video ${playlist.name}`);
      await app.inject({
        method: "POST",
        url: `/creator/playlists/${playlist.id}/items`,
        headers: { cookie: owner.cookie },
        payload: { videoId: video.id },
      });
    }

    const channel = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}`,
    });
    expect(channel.statusCode).toBe(200);
    const publicNames = channel.json().playlists.map((playlist: { name: string }) => playlist.name);
    expect(publicNames).toContain("Public Picks");
    expect(publicNames).not.toContain("Secret Link");
    expect(publicNames).not.toContain("Private Picks");

    const publicPage = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}/playlists/${publicPlaylist.slug}`,
    });
    expect(publicPage.statusCode).toBe(200);
    expect(
      publicPage
        .json()
        .items.some((item: { video: { title: string } }) => item.video.title === "Private Video"),
    ).toBe(false);
    expect(
      publicPage
        .json()
        .items.some((item: { video: { title: string } }) => item.video.title === "Still Processing"),
    ).toBe(false);

    const unlistedPage = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}/playlists/${unlistedPlaylist.slug}`,
    });
    expect(unlistedPage.statusCode).toBe(200);
    expect(unlistedPage.json().playlist.visibility).toBe("UNLISTED");

    const privatePage = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}/playlists/${privatePlaylist.slug}`,
    });
    expect(privatePage.statusCode).toBe(404);
  });

  it("models Watch Later as a profile-owned dedicated list with duplicate protection", async () => {
    const owner = await register("Watch Later Owner", "watch-later-owner@example.com");
    const profile = await prisma.viewerProfile.findFirstOrThrow({
      where: { accountId: owner.user.account.id, isDefault: true },
    });
    const video = await publishedVideo(owner.user.channel.id, "Save Me");

    await prisma.watchLaterItem.create({
      data: { profileId: profile.id, videoId: video.id },
    });
    await expect(
      prisma.watchLaterItem.create({ data: { profileId: profile.id, videoId: video.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.watchLaterItem.count({ where: { profileId: profile.id } })).toBe(1);
  });
});
