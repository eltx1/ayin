import { randomUUID } from "node:crypto";

import { createPrismaClient } from "../../packages/db/dist/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("An isolated TEST_DATABASE_URL is required.");
const prisma = createPrismaClient(databaseUrl);
const [command, rawInput = "{}"] = process.argv.slice(2);
const input = JSON.parse(rawInput);

try {
  if (command === "seed") {
    const fixtureId = randomUUID();
    const result = await prisma.$transaction(async (tx) => {
      const handle = `player-locale-${fixtureId}`;
      const channel = await tx.channel.create({
        data: { handle, name: "Synthetic player locale" },
      });
      const video = await tx.video.create({
        data: {
          channelId: channel.id,
          slug: handle,
          title: "حكاية البحر · 海の記憶 · Original title",
          durationMs: 30_000,
          status: "PUBLISHED",
          visibility: "PUBLIC",
          publishedAt: new Date(),
          mediaAssets: {
            create: {
              channelId: channel.id,
              kind: "SOURCE_VIDEO",
              status: "VALIDATED",
              r2ObjectKey: `e2e/player-locale/${fixtureId}/canonical.mp4`,
              mimeType: "video/mp4",
              sizeBytes: 343136n,
              durationMs: 30_000,
            },
          },
        },
      });
      await tx.videoCreatorMetadata.create({
        data: {
          videoId: video.id,
          chapters: [
            { title: "البداية · Opening", startSeconds: 0 },
            { title: "海の記憶 · المشهد التالي", startSeconds: 15 },
          ],
        },
      });
      for (const [language, label, kind] of [
        ["ar", "العربية الأصلية", "CAPTIONS"],
        ["ja", "日本語", "SUBTITLES"],
        ["en", "Original English", "CAPTIONS"],
      ]) {
        const asset = await tx.mediaAsset.create({
          data: {
            channelId: channel.id,
            videoId: video.id,
            kind: "CAPTION",
            status: "VALIDATED",
            r2ObjectKey: `e2e/player-locale/${fixtureId}/${language}.vtt`,
            mimeType: "text/vtt",
            sizeBytes: 128n,
          },
        });
        await tx.videoCaptionTrack.create({
          data: { videoId: video.id, mediaAssetId: asset.id, languageCode: language, label, kind },
        });
      }
      return {
        fixtureId,
        channelId: channel.id,
        videoId: video.id,
        slug: video.slug,
        title: video.title,
      };
    });
    console.log(JSON.stringify(result));
  } else if (command === "enable-hls") {
    const previousFlag = await prisma.$transaction(async (tx) => {
      const video = await tx.video.findUniqueOrThrow({ where: { id: input.videoId } });
      if (video.slug !== `player-locale-${input.fixtureId}`)
        throw new Error("Fixture video mismatch.");
      const previousFlag = await tx.featureFlag.findUnique({
        where: { key: "player.hls.enabled" },
      });
      await tx.featureFlag.upsert({
        where: { key: "player.hls.enabled" },
        update: { enabled: true, rolloutPercentage: 100 },
        create: { key: "player.hls.enabled", enabled: true, rolloutPercentage: 100 },
      });
      const prefix = `e2e/player-locale/${input.fixtureId}`;
      await tx.mediaPlaybackGeneration.create({
        data: {
          videoId: video.id,
          generation: 1,
          status: "READY",
          fallbackR2ObjectKey: `${prefix}/canonical.mp4`,
          fallbackStatus: "READY",
          hlsMasterR2ObjectKey: `${prefix}/master.m3u8`,
          hlsMasterStatus: "READY",
          readyAt: new Date(),
          renditions: {
            create: [160, 320].map((height) => ({
              identity: `${height}p`,
              width: height * 0.6,
              height,
              videoBitrateKbps: height,
              audioBitrateKbps: 0,
              playlistR2ObjectKey: `${prefix}/${height}p.m3u8`,
              segmentR2Prefix: `${prefix}/${height}p`,
              status: "READY",
              readyAt: new Date(),
            })),
          },
        },
      });
      return previousFlag;
    });
    console.log(JSON.stringify({ previousFlag }));
  } else if (command === "cleanup") {
    if (!/^[0-9a-f-]{36}$/.test(input.fixtureId ?? ""))
      throw new Error("Invalid fixture identity.");
    await prisma.$transaction(async (tx) => {
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: input.channelId } });
      if (channel.handle !== `player-locale-${input.fixtureId}`)
        throw new Error("Fixture ownership mismatch.");
      const video = await tx.video.findUniqueOrThrow({ where: { id: input.videoId } });
      if (video.channelId !== channel.id || video.slug !== channel.handle)
        throw new Error("Fixture video mismatch.");
      await tx.video.delete({ where: { id: video.id } });
      await tx.channel.delete({ where: { id: channel.id } });
      if (Object.hasOwn(input, "previousFlag")) {
        if (input.previousFlag) {
          await tx.featureFlag.update({
            where: { key: "player.hls.enabled" },
            data: {
              enabled: input.previousFlag.enabled,
              rolloutPercentage: input.previousFlag.rolloutPercentage,
            },
          });
        } else await tx.featureFlag.deleteMany({ where: { key: "player.hls.enabled" } });
      }
    });
    console.log(JSON.stringify({ cleaned: true }));
  } else throw new Error("Unsupported player localization fixture command.");
} finally {
  await prisma.$disconnect();
}
