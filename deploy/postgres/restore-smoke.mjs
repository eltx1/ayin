import { createPrismaClient } from "../../packages/db/dist/index.js";

const prisma = createPrismaClient();

try {
  const [accounts, channels, videos, mediaAssets, migrations] = await Promise.all([
    prisma.account.count(),
    prisma.channel.count(),
    prisma.video.count(),
    prisma.mediaAsset.count(),
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS incomplete
      FROM "_prisma_migrations"
    `,
  ]);

  const migrationState = Array.isArray(migrations) ? migrations[0] : null;
  if (!migrationState || Number(migrationState.incomplete) !== 0) {
    throw new Error("restored database contains an incomplete Prisma migration");
  }

  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      counts: { accounts, channels, videos, mediaAssets },
      prismaMigrations: Number(migrationState.total),
    })}\n`,
  );
} finally {
  await prisma.$disconnect();
}
