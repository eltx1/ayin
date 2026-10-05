import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";

const connection = process.env.TEST_DATABASE_URL;
const url = new URL(connection ?? "https://invalid.test");
if (
  process.env.APP_ENV !== "test" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  url.pathname !== "/ayin_e2e" ||
  process.env.DATABASE_URL !== connection
)
  throw new Error("Studio content fixtures require the isolated local ayin_e2e database");
const channelId = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(channelId ?? "")) throw new Error("Expected test channel ID");
const prisma = createPrismaClient(connection);
try {
  await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  await prisma.video.createMany({
    data: Array.from({ length: 130 }, (_, index) => ({
      id: randomUUID(),
      channelId,
      slug: `studio-pagination-${channelId}-${index}`,
      title: `Film night رحلة عالمية ${String(index).padStart(3, "0")}`,
      description: `Saved description ${index}`,
      status: index % 2 ? "PUBLISHED" : "DRAFT",
      visibility: index % 3 ? "PUBLIC" : "PRIVATE",
      updatedAt: new Date(`2026-10-0${1 + Math.floor(index / 45)}T00:00:00.000Z`),
      publishedAt: index % 2 ? new Date("2026-10-01T00:00:00.000Z") : null,
    })),
  });
  console.log(JSON.stringify({ rows: 130 }));
} finally {
  await prisma.$disconnect();
}
