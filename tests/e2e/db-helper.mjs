import { createPrismaClient } from "../../packages/db/dist/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("E2E database URL is required.");

const prisma = createPrismaClient(databaseUrl);
const [command, rawPayload = "{}"] = process.argv.slice(2);
const payload = JSON.parse(rawPayload);

try {
  let result;
  switch (command) {
    case "reset": {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
      await prisma.adminAuditLog.deleteMany();
      result = { ok: true };
      break;
    }
    case "bootstrap": {
      const account = await prisma.account.findUniqueOrThrow({
        where: { email: payload.email },
        include: { profiles: true, channelMemberships: true },
      });
      const channelId = account.channelMemberships[0]?.channelId;
      if (!channelId) throw new Error("Expected a channel membership.");
      result = {
        profiles: account.profiles.length,
        memberships: account.channelMemberships.length,
        uploads: await prisma.playlist.count({ where: { channelId, systemKey: "UPLOADS" } }),
        tv: await prisma.creatorTvChannel.count({ where: { channelId } }),
      };
      break;
    }
    case "upload-association": {
      const uploads = await prisma.playlist.findUniqueOrThrow({
        where: { channelId_systemKey: { channelId: payload.channelId, systemKey: "UPLOADS" } },
      });
      const tv = await prisma.creatorTvChannel.findUniqueOrThrow({ where: { id: payload.tvId } });
      result = {
        playlistItems: await prisma.playlistItem.count({
          where: { playlistId: uploads.id, videoId: payload.videoId },
        }),
        tvUsesUploads: tv.sourcePlaylistId === uploads.id,
      };
      break;
    }
    case "find-video": {
      const video = await prisma.video.findFirstOrThrow({
        where: {
          channelId: payload.channelId,
          ...(payload.title ? { title: payload.title } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      result = { id: video.id, slug: video.slug, title: video.title, status: video.status };
      break;
    }
    case "social-counts": {
      result = {
        subscriptions: await prisma.subscription.count({ where: { channelId: payload.channelId } }),
        reactions: await prisma.reaction.count({ where: { videoId: payload.videoId } }),
        comments: await prisma.comment.count({ where: { videoId: payload.videoId } }),
      };
      break;
    }
    case "grant-admin": {
      await prisma.adminRoleAssignment.upsert({
        where: { accountId: payload.accountId },
        update: { role: "ADMIN" },
        create: { accountId: payload.accountId, role: "ADMIN" },
      });
      result = { ok: true };
      break;
    }
    case "ledger": {
      const ledger = await prisma.earningsLedgerEntry.findFirstOrThrow({
        where: { channelId: payload.channelId, idempotencyKey: payload.idempotencyKey },
      });
      result = {
        grossAmount: ledger.grossAmount?.toString() ?? null,
        amount: ledger.amount.toString(),
        revenueShareBps: ledger.revenueShareBps,
      };
      break;
    }
    case "moderation": {
      const [video, account, auditCount] = await Promise.all([
        prisma.video.findUniqueOrThrow({ where: { id: payload.videoId } }),
        prisma.account.findUniqueOrThrow({ where: { id: payload.accountId } }),
        prisma.adminAuditLog.count({ where: { actorAccountId: payload.adminAccountId } }),
      ]);
      result = { videoStatus: video.status, accountStatus: account.status, auditCount };
      break;
    }
    default:
      throw new Error(`Unknown db-helper command: ${command}`);
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
