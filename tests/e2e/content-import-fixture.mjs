import "../../apps/api/node_modules/reflect-metadata/Reflect.js";
import { createPrismaClient } from "../../packages/db/dist/index.js";
import { MediaProcessingLifecycleService } from "../../apps/api/dist/media/media-processing-lifecycle.service.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2),
  p = JSON.parse(raw),
  db = createPrismaClient(databaseUrl);
try {
  if (typeof p.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(p.accountId))
    throw Error("Invalid actor");
  const account = await db.account.findUniqueOrThrow({ where: { id: p.accountId } });
  if (!account.email.endsWith("@e2e.ayin.test") || !account.email.startsWith("native-import-"))
    throw Error("Target outside import fixture");
  if (command === "seed") {
    await db.adminRoleAssignment.create({ data: { accountId: p.accountId, role: "OPERATIONS" } });
    const membership = await db.channelMember.findFirstOrThrow({
      where: { accountId: p.accountId, role: "OWNER" },
    });
    const channel = await db.channel.update({
      where: { id: membership.channelId },
      data: { isPlatformOwned: true },
    });
    console.log(JSON.stringify({ channelId: channel.id, channelName: channel.name }));
  } else if (command === "evidence") {
    const batches = await db.contentSeedBatch.findMany({
      where: { createdByAccountId: p.accountId },
      include: { items: { include: { video: { include: { mediaProcessingJobs: true } } } } },
    });
    const audits = await db.adminAuditLog.findMany({
      where: { actorAccountId: p.accountId, action: { startsWith: "CONTENT_SEED_" } },
    });
    console.log(
      JSON.stringify({ batches, audits }, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );
  } else if (command === "ready" || command === "failed") {
    const item = await db.contentSeedItem.findUniqueOrThrow({
      where: { id: p.itemId },
      include: { batch: true },
    });
    if (item.batch.createdByAccountId !== p.accountId) throw Error("Wrong original actor");
    const job = await db.mediaProcessingJob.findFirstOrThrow({
      where: { videoId: item.videoId },
      orderBy: { generation: "desc" },
    });
    if (command === "ready") {
      const workerId = "native-import-fixture-worker";
      await db.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          status: "VERIFYING",
          leaseOwner: workerId,
          leaseExpiresAt: new Date(Date.now() + 60000),
        },
      });
      const lifecycle = new MediaProcessingLifecycleService({ client: db });
      const ready = await lifecycle.finalizeReady({
        jobId: job.id,
        workerId,
        metadata: { sizeBytes: 2048, durationMs: 60000, width: 1280, height: 720 },
      });
      if (!ready) throw Error("Worker lifecycle did not reach Ready");
    } else
      await db.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          stage: "FAILED",
          errorCode: "FIXTURE_FAILED",
          errorMessage: "Controlled fixture failure",
        },
      });
    console.log(JSON.stringify({ itemId: item.id, jobId: job.id, status: command }));
  } else if (command === "revoke") {
    await db.adminRoleAssignment.deleteMany({ where: { accountId: p.accountId } });
    await db.adminRoleAssignment.create({
      data: { accountId: p.accountId, role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ revoked: true }));
  } else if (command === "cleanup") {
    const memberships = await db.channelMember.findMany({
      where: { accountId: p.accountId, role: "OWNER" },
    });
    const channelIds = memberships.map((row) => row.channelId);
    await db.$transaction(async (tx) => {
      await tx.adminAuditLog.deleteMany({ where: { actorAccountId: p.accountId } });
      await tx.contentSeedBatch.deleteMany({ where: { createdByAccountId: p.accountId } });
      await tx.mediaAsset.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.video.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.creatorContract.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.channel.deleteMany({ where: { id: { in: channelIds } } });
      await tx.account.delete({ where: { id: p.accountId } });
    });
    console.log(JSON.stringify({ cleaned: true }));
  } else throw Error("Unknown fixture command");
} finally {
  await db.$disconnect();
}
