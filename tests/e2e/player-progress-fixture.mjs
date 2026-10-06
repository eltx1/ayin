import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";

// All mutation and inspection is confined to an explicitly disposable test database.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("An isolated TEST_DATABASE_URL is required.");
const db = createPrismaClient(databaseUrl);
const [command, raw = "{}"] = process.argv.slice(2);
const input = JSON.parse(raw);
try {
  let result;
  if (command === "rows") {
    result = {
      progress: await db.watchProgress.findMany({
        where: { videoId: input.videoId },
        select: { profileId: true, videoId: true, positionMs: true },
        orderBy: { profileId: "asc" },
      }),
      history: await db.watchHistory.findMany({
        where: { videoId: input.videoId },
        select: { profileId: true, videoId: true, viewCount: true },
        orderBy: { profileId: "asc" },
      }),
    };
  } else if (command === "hide-clips") {
    const videoIds = input.videoIds;
    const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    if (
      !Array.isArray(videoIds) ||
      videoIds.length < 1 ||
      videoIds.length > 22 ||
      new Set(videoIds).size !== videoIds.length ||
      videoIds.some((id) => typeof id !== "string" || !uuid.test(id))
    )
      throw new Error("Only an exact bounded list of seeded clip IDs may be hidden.");
    result = await db.$transaction(async (tx) => {
      const clips = await tx.video.findMany({
        where: { id: { in: videoIds } },
        select: {
          id: true,
          slug: true,
          videoForm: true,
          channel: { select: { handle: true, name: true } },
        },
      });
      if (
        clips.length !== videoIds.length ||
        clips.some(
          (clip) =>
            clip.videoForm !== "CLIP" ||
            clip.channel.name !== "Clips Viewer Creator" ||
            !/^clips-viewer-[a-z0-9]+-[a-z0-9]+$/.test(clip.channel.handle) ||
            !clip.slug.startsWith(`${clip.channel.handle}-`) ||
            !/^(?:[1-9]|1[0-9]|2[0-2])$/.test(clip.slug.slice(clip.channel.handle.length + 1)),
        )
      )
        throw new Error("Only synthetic Clips Viewer fixture videos may be hidden.");
      // Keep progress, history and all evidence rows while removing this suite's
      // public feed fixtures from subsequent tests' discovery/pagination.
      return tx.video.updateMany({
        where: { id: { in: videoIds } },
        data: { visibility: "PRIVATE" },
      });
    });
  } else if (command === "default-profile" || command === "revoke") {
    const account = await db.account.findUniqueOrThrow({ where: { id: input.accountId } });
    if (!/^progress-[\w-]+@example\.test$/.test(account.email))
      throw new Error("Only synthetic player-progress accounts may be changed.");
    if (command === "revoke") {
      result = await db.accountSession.updateMany({
        where: { accountId: account.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      result = await db.$transaction(async (tx) => {
        await tx.viewerProfile.updateMany({
          where: { accountId: account.id },
          data: { isDefault: false },
        });
        return tx.viewerProfile.create({
          data: {
            accountId: account.id,
            name: "Second progress viewer",
            slug: `progress-${randomUUID()}`,
            isDefault: true,
          },
          select: { id: true },
        });
      });
    }
  } else {
    throw new Error("Unknown progress fixture command.");
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
