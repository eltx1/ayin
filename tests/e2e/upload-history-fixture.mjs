import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const payload = JSON.parse(process.argv[2] ?? "{}"),
  prisma = createPrismaClient(url.toString());
try {
  if (typeof payload.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.accountId))
    throw Error("Invalid actor");
  await prisma.account.findUniqueOrThrow({ where: { id: payload.accountId } });
  const member = await prisma.channelMember.findFirstOrThrow({
    where: { accountId: payload.accountId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
  });
  const channelId = member.channelId;
  const videos = Array.from({ length: 26 }, (_, i) => ({
    id: randomUUID(),
    channelId,
    slug: `history-${randomUUID()}`,
    title: `Actual saved upload ${i + 1}`,
    status: i === 25 ? "DRAFT" : "UPLOADING",
    visibility: "PRIVATE",
    createdAt: new Date("2026-10-03T12:00:00Z"),
  }));
  await prisma.video.createMany({ data: videos });
  await prisma.mediaAsset.createMany({
    data: videos.map((v) => ({
      videoId: v.id,
      channelId,
      kind: "SOURCE_VIDEO",
      status: "PENDING",
      r2ObjectKey: `fixture/history/${v.id}`,
      mimeType: "video/mp4",
      sizeBytes: 42n,
    })),
  });
  const videoId = videos[0].id;
  await prisma.mediaProcessingJob.createMany({
    data: [1, 2].map((generation) => ({
      videoId,
      generation,
      sourceMimeType: "video/mp4",
      sourceSizeBytes: 42n,
      stagingKey: `fixture-staging-${randomUUID()}`,
      outputR2ObjectKey: `fixture-output-${randomUUID()}`,
      status: "FAILED",
      progressPercent: 0,
      errorCode: "SOURCE_REJECTED",
      errorMessage: "PRIVATE FIXTURE MESSAGE",
    })),
  });
  process.stdout.write(JSON.stringify({ channelId, videoId }));
} finally {
  await prisma.$disconnect();
}
