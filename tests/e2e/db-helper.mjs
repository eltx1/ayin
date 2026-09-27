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
        include: { viewerProfiles: true, channelMemberships: true },
      });
      const channelId = account.channelMemberships[0]?.channelId;
      if (!channelId) throw new Error("Expected a channel membership.");
      result = {
        profiles: account.viewerProfiles.length,
        memberships: account.channelMemberships.length,
        uploads: await prisma.playlist.count({ where: { channelId, systemKey: "UPLOADS" } }),
        tv: await prisma.creatorTvChannel.count({ where: { channelId } }),
      };
      break;
    }
    // E2E has no long-running FFmpeg worker, so mirror the tested worker finalization state.
    case "mark-media-ready": {
      const job = await prisma.mediaProcessingJob.findFirstOrThrow({
        where: { videoId: payload.videoId },
        orderBy: { generation: "desc" },
      });
      const source = await prisma.mediaAsset.findFirstOrThrow({
        where: {
          videoId: payload.videoId,
          kind: "SOURCE_VIDEO",
          status: "UPLOADED",
          removedAt: null,
        },
      });
      const canonical = await prisma.mediaAsset.create({
        data: {
          videoId: payload.videoId,
          channelId: source.channelId,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          r2ObjectKey: job.outputR2ObjectKey,
          mimeType: "video/mp4",
          sizeBytes: 2048n,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        },
      });
      await prisma.$transaction([
        prisma.mediaAsset.update({
          where: { id: source.id },
          data: { status: "REMOVED", removedAt: new Date() },
        }),
        prisma.mediaProcessingJob.update({
          where: { id: job.id },
          data: {
            finalAssetId: canonical.id,
            status: "READY",
            stage: "READY",
            progressPercent: 100,
            outputSizeBytes: 2048n,
            completedAt: new Date(),
          },
        }),
        prisma.video.update({
          where: { id: payload.videoId },
          data: { status: "DRAFT", durationMs: 120_000 },
        }),
      ]);
      result = { ok: true };
      break;
    }
    case "seed-player-video": {
      const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const channel = await prisma.channel.create({
        data: { handle: `hls-${suffix}`, name: "HLS E2E Channel", status: "ACTIVE" },
      });
      const video = await prisma.video.create({
        data: {
          channelId: channel.id,
          slug: `hls-player-${suffix}`,
          title: "HLS Player E2E",
          status: "PUBLISHED",
          visibility: "PUBLIC",
          commentsEnabled: true,
          durationMs: 120_000,
          publishedAt: new Date(),
        },
      });
      const sourceKey = `e2e/player/${video.id}/canonical.mp4`;
      await prisma.mediaAsset.create({
        data: {
          videoId: video.id,
          channelId: channel.id,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          r2ObjectKey: sourceKey,
          mimeType: "video/mp4",
          sizeBytes: 2048n,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        },
      });
      result = { id: video.id, slug: video.slug, channelId: channel.id, sourceKey };
      break;
    }
    case "configure-hls-playback": {
      const enabled = payload.enabled !== false;
      await prisma.featureFlag.upsert({
        where: { key: "player.hls.enabled" },
        update: { enabled, rolloutPercentage: 100 },
        create: {
          key: "player.hls.enabled",
          description: "Task 41 E2E HLS playback gate",
          enabled,
          rolloutPercentage: 100,
        },
      });
      if (!enabled || !payload.videoId) {
        result = { enabled };
        break;
      }
      const latest = await prisma.mediaPlaybackGeneration.findFirst({
        where: { videoId: payload.videoId },
        orderBy: { generation: "desc" },
        select: { generation: true },
      });
      const generation = (latest?.generation ?? 0) + 1;
      const prefix = `e2e/player/${payload.videoId}/g${generation}`;
      const created = await prisma.mediaPlaybackGeneration.create({
        data: {
          videoId: payload.videoId,
          generation,
          status: "READY",
          fallbackR2ObjectKey: `${prefix}/fallback.mp4`,
          fallbackStatus: "READY",
          hlsMasterR2ObjectKey: `${prefix}/master.m3u8`,
          hlsMasterStatus: "READY",
          readyAt: new Date(),
          renditions: {
            create: [
              {
                identity: "360p",
                width: 640,
                height: 360,
                videoBitrateKbps: 700,
                audioBitrateKbps: 96,
                playlistR2ObjectKey: `${prefix}/360p/index.m3u8`,
                segmentR2Prefix: `${prefix}/360p/segments`,
                status: "READY",
                readyAt: new Date(),
              },
              {
                identity: "720p",
                width: 1280,
                height: 720,
                videoBitrateKbps: 2800,
                audioBitrateKbps: 128,
                playlistR2ObjectKey: `${prefix}/720p/index.m3u8`,
                segmentR2Prefix: `${prefix}/720p/segments`,
                status: "READY",
                readyAt: new Date(),
              },
            ],
          },
        },
      });
      result = {
        enabled,
        fallbackKey: created.fallbackR2ObjectKey,
        masterKey: created.hlsMasterR2ObjectKey,
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
    case "reset-operator-state": {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "MediaProcessingJob", "MediaProcessingWorker" CASCADE',
      );
      result = { ok: true };
      break;
    }
    case "seed-operator-job": {
      const video = await prisma.video.create({
        data: {
          channelId: payload.channelId,
          slug: `operator-workspace-${payload.channelId}`,
          title: "Operator fixture video",
          status: "DRAFT",
        },
      });
      const job = await prisma.mediaProcessingJob.create({
        data: {
          videoId: video.id,
          generation: 1,
          status: "FAILED",
          sourceMimeType: "video/mp4",
          sourceSizeBytes: 1024n,
          stagingKey: `test/operator/${video.id}/source.mp4`,
          outputR2ObjectKey: `test/operator/${video.id}/output.mp4`,
          errorCode: "TEST_FAILURE",
        },
      });
      result = { jobId: job.id, videoId: video.id };
      break;
    }
    case "operator-action-evidence": {
      result = {
        jobs: await prisma.mediaProcessingJob.findMany({
          where: { videoId: payload.videoId },
          orderBy: { generation: "asc" },
          select: { id: true, generation: true, status: true },
        }),
        audits: await prisma.adminAuditLog.findMany({
          where: { actorAccountId: payload.accountId, action: { startsWith: "media_processing." } },
          select: { action: true, entityId: true },
        }),
      };
      break;
    }
    case "operator-ready-source": {
      const job = await prisma.mediaProcessingJob.findUniqueOrThrow({
        where: { id: payload.jobId },
      });
      const video = await prisma.video.findUniqueOrThrow({ where: { id: job.videoId } });
      await prisma.mediaAsset.create({
        data: {
          videoId: video.id,
          channelId: video.channelId,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          r2ObjectKey: job.outputR2ObjectKey,
          mimeType: "video/mp4",
          sizeBytes: 1024n,
          durationMs: 1000,
          width: 640,
          height: 360,
        },
      });
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          status: "READY",
          stage: "READY",
          progressPercent: 100,
          completedAt: new Date(),
        },
      });
      result = { ok: true };
      break;
    }
    case "configure-adaptive-operator": {
      const values = {
        mediaHlsEnabled: true,
        mediaHlsBackfillEnabled: true,
        mediaHlsBackfillPaused: false,
        mediaHlsBackfillBatchSize: 2,
        mediaHlsBackfillMaxInFlight: 1,
      };
      for (const [key, value] of Object.entries(values)) {
        await prisma.platformSetting.upsert({
          where: { namespace_key: { namespace: "UPLOAD", key } },
          create: {
            namespace: "UPLOAD",
            key,
            valueType: typeof value === "boolean" ? "BOOLEAN" : "INTEGER",
            value,
          },
          update: {
            value,
            valueType: typeof value === "boolean" ? "BOOLEAN" : "INTEGER",
            schemaVersion: 1,
          },
        });
      }
      if (payload.videoId) {
        const video = await prisma.video.update({
          where: { id: payload.videoId },
          data: { status: "PUBLISHED", visibility: "PUBLIC" },
        });
        await prisma.channel.update({ where: { id: video.channelId }, data: { status: "ACTIVE" } });
      }
      result = { ok: true };
      break;
    }
    case "reset-adaptive-operator": {
      await prisma.platformSetting.deleteMany({
        where: {
          namespace: "UPLOAD",
          key: {
            in: [
              "mediaHlsEnabled",
              "mediaHlsBackfillEnabled",
              "mediaHlsBackfillPaused",
              "mediaHlsBackfillBatchSize",
              "mediaHlsBackfillMaxInFlight",
            ],
          },
        },
      });
      result = { ok: true };
      break;
    }
    case "adaptive-action-evidence": {
      result = {
        audits: await prisma.adminAuditLog.findMany({
          where: { actorAccountId: payload.accountId, action: { startsWith: "media_adaptive." } },
          orderBy: { createdAt: "asc" },
          select: { action: true, metadata: true },
        }),
      };
      break;
    }
    case "reset-discovery-operator": {
      await prisma.recommendationExposure.deleteMany();
      await prisma.platformSetting.deleteMany({
        where: { namespace: "DISCOVERY", key: "trendingEngine" },
      });
      result = { ok: true };
      break;
    }
    case "seed-observed-recommendations": {
      await prisma.recommendationExposure.create({
        data: {
          versionId: "e2e-observed-v1",
          algorithmId: "e2e-ranked",
          surface: "HOME",
          mode: "PERSONALIZED",
          rankingSize: 2,
          itemIds: ["example-one", "example-two"],
          components: {},
        },
      });
      result = { ok: true };
      break;
    }
    case "discovery-action-evidence": {
      result = {
        setting: await prisma.platformSetting.findUnique({
          where: { namespace_key: { namespace: "DISCOVERY", key: "trendingEngine" } },
          select: { value: true },
        }),
        audits: await prisma.adminAuditLog.findMany({
          where: { actorAccountId: payload.accountId, action: "TRENDING_ENGINE_CONFIG_UPDATED" },
          select: { reason: true, metadata: true },
        }),
      };
      break;
    }
    case "grant-operator-role": {
      if (!["OPERATIONS", "SUPERADMIN", "FINANCE_MANAGER"].includes(payload.role))
        throw new Error("Unsupported test operator role.");
      await prisma.adminRoleAssignment.upsert({
        where: { accountId_role: { accountId: payload.accountId, role: payload.role } },
        update: {},
        create: { accountId: payload.accountId, role: payload.role },
      });
      result = { ok: true };
      break;
    }
    case "grant-admin": {
      await prisma.adminRoleAssignment.upsert({
        where: { accountId_role: { accountId: payload.accountId, role: "ADMIN" } },
        update: {},
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
