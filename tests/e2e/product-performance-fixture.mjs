import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { createPrismaClient } from "../../packages/db/dist/index.js";

const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw new Error("Product runtime fixture requires isolated local ayin_e2e");
const prisma = createPrismaClient(url.toString());
const [command, raw = "{}"] = process.argv.slice(2);
const input = JSON.parse(raw);
try {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    include: { channelMemberships: true, viewerProfiles: true },
  });
  if (!/^product-runtime-[a-z0-9-]+@e2e\.ayin\.test$/.test(account.email))
    throw new Error("Only this runtime fixture's synthetic account is permitted");
  const channelId = account.channelMemberships[0]?.channelId;
  if (!channelId) throw new Error("Missing synthetic creator channel");
  if (command === "seed") {
    if (input.media !== undefined && input.media !== "decoded-webm")
      throw new Error("Unknown synthetic media mode");
    const decoded = input.media === "decoded-webm";
    const media = decoded
      ? {
          extension: "mp4",
          mimeType: "video/mp4",
          sizeBytes: BigInt(
            statSync(new URL("./fixtures/clips-viewport.webm", import.meta.url)).size,
          ),
          durationMs: 30_000,
          width: 96,
          height: 160,
        }
      : {
          extension: "mp4",
          mimeType: "video/mp4",
          sizeBytes: 2048n,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        };
    const suffix = randomUUID();
    const video = await prisma.video.create({
      data: {
        channelId,
        slug: `runtime-feature-${suffix}`,
        title: "Runtime laboratory feature",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: media.durationMs,
        commentsEnabled: true,
        publishedAt: new Date(),
      },
    });
    await prisma.mediaAsset.create({
      data: {
        channelId,
        videoId: video.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `e2e/runtime/${suffix}/source.${media.extension}`,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        durationMs: media.durationMs,
        width: media.width,
        height: media.height,
      },
    });
    // The ordinary route fixture has unavailable media. Only the separate
    // decoded-media lab substitutes accepted WebM bytes over real loopback HTTP
    // while retaining the existing MP4 canonical fixture declaration (as Clips does).
    const movie = await prisma.movie.create({
      data: {
        title: "Runtime laboratory movie",
        slug: `runtime-movie-${suffix}`,
        synopsis: "Synthetic local catalog entry for controlled route measurements.",
        releaseYear: 2026,
        runtimeMinutes: 2,
        maturityRating: "PG",
        originalLanguage: "en",
        status: "PUBLISHED",
        primaryVideoId: video.id,
        publishedAt: new Date(),
        availability: { create: { territoryCode: "*", rule: "ALLOW" } },
      },
    });
    await prisma.video.createMany({
      data: Array.from({ length: 23 }, (_, index) => ({
        channelId,
        slug: `runtime-draft-${suffix}-${index}`,
        title: `Runtime laboratory draft ${index + 1}`,
        status: "DRAFT",
        visibility: "PRIVATE",
      })),
    });
    await prisma.adminRoleAssignment.create({
      data: { accountId: account.id, role: "OPERATIONS" },
    });
    const [accounts, channels, videos, movies] = await Promise.all([
      prisma.account.count(),
      prisma.channel.count(),
      prisma.video.count(),
      prisma.movie.count(),
    ]);
    const [{ version }] = await prisma.$queryRawUnsafe(
      "SELECT current_setting('server_version_num') AS version",
    );
    const postgresVersionNumber = Number(version);
    if (!Number.isSafeInteger(postgresVersionNumber))
      throw new Error("Unexpected PostgreSQL version metadata");
    process.stdout.write(
      JSON.stringify({
        movieSlug: movie.slug,
        videoSlug: video.slug,
        videos: 24,
        databaseInventory: { accounts, channels, videos, movies, postgresVersionNumber },
        sourceObjectKey: `e2e/runtime/${suffix}/source.${media.extension}`,
      }),
    );
  } else if (command === "cleanup") {
    const videos = await prisma.video.findMany({ where: { channelId }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      await tx.movie.deleteMany({
        where: { primaryVideoId: { in: videos.map((video) => video.id) } },
      });
      await tx.playlistItem.deleteMany({ where: { playlist: { channelId } } });
      await tx.tvScheduleItem.deleteMany({ where: { tvChannel: { channelId } } });
      await tx.mediaAsset.deleteMany({ where: { channelId } });
      await tx.video.deleteMany({ where: { channelId } });
      await tx.creatorContract.deleteMany({ where: { channelId, status: "PENDING" } });
      await tx.channel.delete({ where: { id: channelId } });
      await tx.account.delete({ where: { id: account.id } });
    });
    process.stdout.write(JSON.stringify({ cleaned: true }));
  } else throw new Error("Unknown product runtime fixture command");
} finally {
  await prisma.$disconnect();
}
