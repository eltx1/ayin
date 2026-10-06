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
