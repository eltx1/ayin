from pathlib import Path

ROOT = Path.cwd()


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    source = path.read_text()
    if new in source:
        return
    if old not in source:
        raise RuntimeError(f"Patch anchor not found in {relative}")
    path.write_text(source.replace(old, new, 1))


def write(relative: str, content: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


replace_once(
    "packages/db/prisma/schema.prisma",
    '''enum MediaAssetStatus {
  PENDING
  UPLOADED
  VALIDATED
  REJECTED
  REMOVED
}
''',
    '''enum MediaAssetStatus {
  PENDING
  UPLOADED
  VALIDATED
  REJECTED
  REMOVED
}

enum MediaProcessingJobStatus {
  INGESTING
  QUEUED
  PROCESSING
  UPLOADING
  VERIFYING
  READY
  FAILED
  CANCELLED
}
''',
)
replace_once(
    "packages/db/prisma/schema.prisma",
    "  mediaAssets            MediaAsset[]\n",
    "  mediaAssets            MediaAsset[]\n  mediaProcessingJobs     MediaProcessingJob[]\n",
)
replace_once(
    "packages/db/prisma/schema.prisma",
    '  communityPost CommunityPost? @relation("CommunityImageAsset")\n',
    '  communityPost CommunityPost? @relation("CommunityImageAsset")\n  processingJob MediaProcessingJob? @relation("MediaProcessingFinalAsset")\n',
)
replace_once(
    "packages/db/prisma/schema.prisma",
    '''  @@index([videoId, kind, status])
  @@index([channelId, kind])
}

model Playlist {
''',
    '''  @@index([videoId, kind, status])
  @@index([channelId, kind])
}

model MediaProcessingJob {
  id                String                   @id @default(uuid()) @db.Uuid
  videoId           String                   @db.Uuid
  finalAssetId      String?                  @unique @db.Uuid
  generation        Int                      @default(1)
  status            MediaProcessingJobStatus @default(INGESTING)
  sourceMimeType    String                   @db.VarChar(255)
  sourceSizeBytes   BigInt
  stagingKey        String                   @unique @db.VarChar(1024)
  inputR2ObjectKey  String?                  @db.VarChar(1024)
  outputR2ObjectKey String                   @unique @db.VarChar(1024)
  outputSizeBytes   BigInt?
  attempt           Int                      @default(0)
  priority          Int                      @default(0)
  progressPercent   Int                      @default(0)
  stage             String?                  @db.VarChar(64)
  leaseOwner        String?                  @db.VarChar(255)
  leaseExpiresAt    DateTime?
  heartbeatAt       DateTime?
  errorCode         String?                  @db.VarChar(128)
  errorMessage      String?                  @db.Text
  queuedAt          DateTime?
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime                 @default(now())
  updatedAt         DateTime                 @updatedAt

  video      Video       @relation(fields: [videoId], references: [id], onDelete: Cascade)
  finalAsset MediaAsset? @relation("MediaProcessingFinalAsset", fields: [finalAssetId], references: [id], onDelete: SetNull)

  @@unique([videoId, generation])
  @@index([status, priority, queuedAt])
  @@index([leaseExpiresAt])
  @@index([videoId, status])
}

model Playlist {
''',
)

settings = '''  mediaProcessingEnabled: {
    namespace: "UPLOAD",
    key: "mediaProcessingEnabled",
    valueType: "BOOLEAN",
    defaultValue: true,
    schema: z.boolean(),
    section: "uploads",
    label: "Media processing enabled",
    description:
      "Global pause switch for new FFmpeg processing claims. Active jobs finish safely before the queue pauses.",
    control: "toggle",
    highImpact: true,
    superadminOnly: false,
  },
  mediaProcessingConcurrentJobs: {
    namespace: "UPLOAD",
    key: "mediaProcessingConcurrentJobs",
    valueType: "INTEGER",
    defaultValue: 1,
    schema: z.number().int().min(1).max(128),
    section: "uploads",
    label: "Concurrent FFmpeg workers",
    description:
      "Global maximum number of video-processing jobs allowed to run at once across every AYIN worker process and server.",
    control: "number",
    unit: "jobs",
    highImpact: true,
    superadminOnly: false,
  },
  mediaProcessingFfmpegThreadsPerJob: {
    namespace: "UPLOAD",
    key: "mediaProcessingFfmpegThreadsPerJob",
    valueType: "INTEGER",
    defaultValue: 1,
    schema: z.number().int().min(1).max(32),
    section: "uploads",
    label: "FFmpeg threads per job",
    description: "Maximum FFmpeg CPU threads assigned to each active video-processing job.",
    control: "number",
    unit: "threads",
    highImpact: true,
    superadminOnly: false,
  },
  mediaProcessingRetryLimit: {
    namespace: "UPLOAD",
    key: "mediaProcessingRetryLimit",
    valueType: "INTEGER",
    defaultValue: 3,
    schema: z.number().int().min(1).max(10),
    section: "uploads",
    label: "Processing retry limit",
    description:
      "Maximum processing claims for a video generation before AYIN marks the job failed for operator review.",
    control: "number",
    unit: "attempts",
    highImpact: false,
    superadminOnly: false,
  },
  mediaProcessingLeaseSeconds: {
    namespace: "UPLOAD",
    key: "mediaProcessingLeaseSeconds",
    valueType: "INTEGER",
    defaultValue: 180,
    schema: z.number().int().min(30).max(1800),
    section: "uploads",
    label: "Worker lease duration",
    description:
      "How long an active processing claim remains valid without a heartbeat before another worker may recover it.",
    control: "number",
    unit: "seconds",
    highImpact: false,
    superadminOnly: false,
  },
  mediaProcessingMaxHeight: {
    namespace: "UPLOAD",
    key: "mediaProcessingMaxHeight",
    valueType: "INTEGER",
    defaultValue: 1080,
    schema: z.number().int().min(360).max(2160),
    section: "uploads",
    label: "Maximum processed video height",
    description: "Maximum output height for the canonical playback MP4. AYIN does not upscale smaller video.",
    control: "number",
    unit: "px",
    highImpact: false,
    superadminOnly: false,
  },
  mediaProcessingVideoCrf: {
    namespace: "UPLOAD",
    key: "mediaProcessingVideoCrf",
    valueType: "INTEGER",
    defaultValue: 23,
    schema: z.number().int().min(16).max(32),
    section: "uploads",
    label: "H.264 CRF",
    description: "Quality target for canonical H.264 processing. Lower values use more storage and CPU.",
    control: "number",
    highImpact: false,
    superadminOnly: false,
  },
  mediaProcessingPreset: {
    namespace: "UPLOAD",
    key: "mediaProcessingPreset",
    valueType: "STRING",
    defaultValue: "veryfast",
    schema: z.enum(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"]),
    section: "uploads",
    label: "FFmpeg H.264 preset",
    description: "CPU-versus-compression preset used for canonical H.264 processing.",
    control: "select",
    options: ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"],
    highImpact: false,
    superadminOnly: false,
  },
'''
replace_once(
    "apps/api/src/platform-config/platform-settings.catalog.ts",
    "  initialMediaCompatibilityProfileText: {\n",
    settings + "  initialMediaCompatibilityProfileText: {\n",
)

write(
    "packages/db/prisma/migrations/20260904023000_media_processing_queue/migration.sql",
    '''CREATE TYPE "MediaProcessingJobStatus" AS ENUM ('INGESTING', 'QUEUED', 'PROCESSING', 'UPLOADING', 'VERIFYING', 'READY', 'FAILED', 'CANCELLED');

CREATE TABLE "MediaProcessingJob" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "finalAssetId" UUID,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "status" "MediaProcessingJobStatus" NOT NULL DEFAULT 'INGESTING',
    "sourceMimeType" VARCHAR(255) NOT NULL,
    "sourceSizeBytes" BIGINT NOT NULL,
    "stagingKey" VARCHAR(1024) NOT NULL,
    "inputR2ObjectKey" VARCHAR(1024),
    "outputR2ObjectKey" VARCHAR(1024) NOT NULL,
    "outputSizeBytes" BIGINT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "stage" VARCHAR(64),
    "leaseOwner" VARCHAR(255),
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "errorCode" VARCHAR(128),
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaProcessingJob_finalAssetId_key" ON "MediaProcessingJob"("finalAssetId");
CREATE UNIQUE INDEX "MediaProcessingJob_stagingKey_key" ON "MediaProcessingJob"("stagingKey");
CREATE UNIQUE INDEX "MediaProcessingJob_outputR2ObjectKey_key" ON "MediaProcessingJob"("outputR2ObjectKey");
CREATE UNIQUE INDEX "MediaProcessingJob_videoId_generation_key" ON "MediaProcessingJob"("videoId", "generation");
CREATE INDEX "MediaProcessingJob_status_priority_queuedAt_idx" ON "MediaProcessingJob"("status", "priority", "queuedAt");
CREATE INDEX "MediaProcessingJob_leaseExpiresAt_idx" ON "MediaProcessingJob"("leaseExpiresAt");
CREATE INDEX "MediaProcessingJob_videoId_status_idx" ON "MediaProcessingJob"("videoId", "status");

ALTER TABLE "MediaProcessingJob" ADD CONSTRAINT "MediaProcessingJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaProcessingJob" ADD CONSTRAINT "MediaProcessingJob_finalAssetId_fkey" FOREIGN KEY ("finalAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
''',
)

write(
    "apps/api/src/media/media-processing-queue.service.ts",
    '''import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";

const ACTIVE_STATUSES = ["PROCESSING", "UPLOADING", "VERIFYING"] as const;
const QUEUE_ADVISORY_LOCK = 86192028;

export interface MediaProcessingCapacity {
  enabled: boolean;
  concurrentJobs: number;
  retryLimit: number;
  leaseSeconds: number;
}

@Injectable()
export class MediaProcessingQueueService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async capacity(): Promise<MediaProcessingCapacity> {
    const [enabled, concurrentJobs, retryLimit, leaseSeconds] = await Promise.all([
      this.settings.get("mediaProcessingEnabled"),
      this.settings.get("mediaProcessingConcurrentJobs"),
      this.settings.get("mediaProcessingRetryLimit"),
      this.settings.get("mediaProcessingLeaseSeconds"),
    ]);
    return {
      enabled: enabled as boolean,
      concurrentJobs: concurrentJobs as number,
      retryLimit: retryLimit as number,
      leaseSeconds: leaseSeconds as number,
    };
  }

  async claimNext(workerId: string) {
    const owner = workerId.trim();
    if (!owner || owner.length > 255) throw new Error("A valid media worker identifier is required.");

    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock($1)", QUEUE_ADVISORY_LOCK);
      const capacity = await this.capacityInTransaction(tx);
      const now = new Date();
      await this.recoverStaleInTransaction(tx, now, capacity.retryLimit);
      if (!capacity.enabled) return null;

      const activeCount = await tx.mediaProcessingJob.count({
        where: { status: { in: [...ACTIVE_STATUSES] } },
      });
      if (activeCount >= capacity.concurrentJobs) return null;

      const candidate = await tx.mediaProcessingJob.findFirst({
        where: { status: "QUEUED", queuedAt: { lte: now } },
        orderBy: [{ priority: "desc" }, { queuedAt: "asc" }, { createdAt: "asc" }],
      });
      if (!candidate) return null;

      const leaseExpiresAt = new Date(now.getTime() + capacity.leaseSeconds * 1000);
      const changed = await tx.mediaProcessingJob.updateMany({
        where: { id: candidate.id, status: "QUEUED" },
        data: {
          status: "PROCESSING",
          stage: "CLAIMED",
          attempt: { increment: 1 },
          leaseOwner: owner,
          leaseExpiresAt,
          heartbeatAt: now,
          startedAt: candidate.startedAt ?? now,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (changed.count !== 1) return null;
      return tx.mediaProcessingJob.findUnique({ where: { id: candidate.id } });
    });
  }

  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const leaseSeconds = (await this.settings.get("mediaProcessingLeaseSeconds")) as number;
    const now = new Date();
    const updated = await this.database.client.mediaProcessingJob.updateMany({
      where: { id: jobId, leaseOwner: workerId, status: { in: [...ACTIVE_STATUSES] } },
      data: {
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
      },
    });
    return updated.count === 1;
  }

  async requeueAfterFailure(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
  }) {
    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock($1)", QUEUE_ADVISORY_LOCK);
      const retryLimit = (await this.settings.getResolvedInTransaction(
        tx,
        "mediaProcessingRetryLimit",
      )).value as number;
      const job = await tx.mediaProcessingJob.findFirst({
        where: {
          id: input.jobId,
          leaseOwner: input.workerId,
          status: { in: [...ACTIVE_STATUSES] },
        },
      });
      if (!job) return null;

      const terminal = job.attempt >= retryLimit;
      const backoffSeconds = Math.min(60, 2 ** Math.max(0, job.attempt));
      return tx.mediaProcessingJob.update({
        where: { id: job.id },
        data: terminal
          ? {
              status: "FAILED",
              stage: "FAILED",
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: input.errorCode.slice(0, 128),
              errorMessage: input.errorMessage,
            }
          : {
              status: "QUEUED",
              stage: "RETRY_WAIT",
              queuedAt: new Date(Date.now() + backoffSeconds * 1000),
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: input.errorCode.slice(0, 128),
              errorMessage: input.errorMessage,
            },
      });
    });
  }

  async overview() {
    const [capacity, grouped] = await Promise.all([
      this.capacity(),
      this.database.client.mediaProcessingJob.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
    const active = ACTIVE_STATUSES.reduce((total, status) => total + (counts[status] ?? 0), 0);
    return { capacity, active, counts };
  }

  private async capacityInTransaction(tx: Prisma.TransactionClient): Promise<MediaProcessingCapacity> {
    const [enabled, concurrentJobs, retryLimit, leaseSeconds] = await Promise.all([
      this.settings.getResolvedInTransaction(tx, "mediaProcessingEnabled"),
      this.settings.getResolvedInTransaction(tx, "mediaProcessingConcurrentJobs"),
      this.settings.getResolvedInTransaction(tx, "mediaProcessingRetryLimit"),
      this.settings.getResolvedInTransaction(tx, "mediaProcessingLeaseSeconds"),
    ]);
    return {
      enabled: enabled.value as boolean,
      concurrentJobs: concurrentJobs.value as number,
      retryLimit: retryLimit.value as number,
      leaseSeconds: leaseSeconds.value as number,
    };
  }

  private async recoverStaleInTransaction(
    tx: Prisma.TransactionClient,
    now: Date,
    retryLimit: number,
  ): Promise<void> {
    const stale = await tx.mediaProcessingJob.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] }, leaseExpiresAt: { lt: now } },
      select: { id: true, attempt: true },
    });

    for (const job of stale) {
      const terminal = job.attempt >= retryLimit;
      await tx.mediaProcessingJob.updateMany({
        where: {
          id: job.id,
          status: { in: [...ACTIVE_STATUSES] },
          leaseExpiresAt: { lt: now },
        },
        data: terminal
          ? {
              status: "FAILED",
              stage: "STALE_LEASE_FAILED",
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: "STALE_WORKER_LEASE",
              errorMessage: "The media worker stopped heartbeating and exhausted its retry limit.",
            }
          : {
              status: "QUEUED",
              stage: "STALE_LEASE_RECOVERED",
              queuedAt: now,
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: "STALE_WORKER_LEASE",
              errorMessage: "The media worker stopped heartbeating; AYIN recovered the job safely.",
            },
      });
    }
  }
}
''',
)

replace_once(
    "apps/api/src/media/media.module.ts",
    'import { MediaUploadController } from "./media-upload.controller.js";\n',
    'import { MediaProcessingQueueService } from "./media-processing-queue.service.js";\nimport { MediaUploadController } from "./media-upload.controller.js";\n',
)
replace_once(
    "apps/api/src/media/media.module.ts",
    "    UploadRateLimiter,\n    MediaUploadService,\n",
    "    UploadRateLimiter,\n    MediaUploadService,\n    MediaProcessingQueueService,\n",
)
replace_once(
    "apps/api/src/media/media.module.ts",
    "  exports: [MEDIA_STORAGE_ADAPTER, MEDIA_STORAGE_CONFIG, MediaUploadService],\n",
    '''  exports: [
    MEDIA_STORAGE_ADAPTER,
    MEDIA_STORAGE_CONFIG,
    MediaUploadService,
    MediaProcessingQueueService,
  ],
''',
)

write(
    "apps/api/test/media-processing-queue.integration.test.ts",
    '''import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("media processing queue global concurrency", () => {
  let moduleReference: TestingModule;
  let queue: MediaProcessingQueueService;
  let settings: PlatformSettingsService;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "media-queue-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "media-queue-upload-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    queue = moduleReference.get(MediaProcessingQueueService);
    settings = moduleReference.get(PlatformSettingsService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Channel", "PlatformSetting" CASCADE');
  });

  afterAll(async () => {
    await moduleReference.close();
    await prisma.$disconnect();
  });

  async function createQueuedJob(
    suffix: string,
    status: "QUEUED" | "READY" | "PROCESSING" = "QUEUED",
  ) {
    const channel = await prisma.channel.create({
      data: { handle: `queue-${suffix}`, name: `Queue ${suffix}`, status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: `queue-video-${suffix}`,
        title: `Queue video ${suffix}`,
        status: "VALIDATING",
      },
    });
    const now = new Date();
    return prisma.mediaProcessingJob.create({
      data: {
        videoId: video.id,
        generation: 1,
        status,
        sourceMimeType: "video/quicktime",
        sourceSizeBytes: 1024n,
        stagingKey: `staging/${video.id}/source.mov`,
        outputR2ObjectKey: `channels/${channel.id}/media/${video.id}/processed-v1.mp4`,
        queuedAt: status === "QUEUED" ? now : null,
        completedAt: status === "READY" ? now : null,
        progressPercent: status === "READY" ? 100 : 0,
        ...(status === "PROCESSING"
          ? {
              attempt: 1,
              leaseOwner: "dead-worker",
              leaseExpiresAt: new Date(now.getTime() - 60_000),
              heartbeatAt: new Date(now.getTime() - 120_000),
            }
          : {}),
      },
    });
  }

  async function setSetting(
    key:
      | "mediaProcessingEnabled"
      | "mediaProcessingConcurrentJobs"
      | "mediaProcessingRetryLimit"
      | "mediaProcessingLeaseSeconds",
    value: boolean | number,
  ) {
    await prisma.$transaction((tx) => settings.setInTransaction(tx, key, value));
  }

  it("never gives the same queued job to two parallel claimers", async () => {
    await setSetting("mediaProcessingConcurrentJobs", 2);
    const job = await createQueuedJob("parallel");
    const claims = await Promise.all([queue.claimNext("worker-a"), queue.claimNext("worker-b")]);
    const claimed = claims.filter((item): item is NonNullable<typeof item> => item !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(job.id);
    expect(claimed[0]?.attempt).toBe(1);
  });

  it("enforces a database-global concurrency cap and expands immediately when admin raises it", async () => {
    await setSetting("mediaProcessingConcurrentJobs", 1);
    const first = await createQueuedJob("cap-one");
    const second = await createQueuedJob("cap-two");
    expect((await queue.claimNext("worker-a"))?.id).toBe(first.id);
    expect(await queue.claimNext("worker-b")).toBeNull();
    await setSetting("mediaProcessingConcurrentJobs", 2);
    expect((await queue.claimNext("worker-b"))?.id).toBe(second.id);
  });

  it("treats READY as terminal and never automatically claims it again", async () => {
    const ready = await createQueuedJob("ready", "READY");
    expect(await queue.claimNext("worker-a")).toBeNull();
    const stored = await prisma.mediaProcessingJob.findUnique({ where: { id: ready.id } });
    expect(stored?.status).toBe("READY");
    expect(stored?.attempt).toBe(0);
  });

  it("recovers an expired worker lease and safely reclaims the job within the retry budget", async () => {
    await setSetting("mediaProcessingRetryLimit", 3);
    const stale = await createQueuedJob("stale", "PROCESSING");
    const recovered = await queue.claimNext("worker-recovery");
    expect(recovered?.id).toBe(stale.id);
    expect(recovered?.status).toBe("PROCESSING");
    expect(recovered?.attempt).toBe(2);
    expect(recovered?.leaseOwner).toBe("worker-recovery");
  });

  it("fails stale jobs after the retry limit instead of creating an infinite loop", async () => {
    await setSetting("mediaProcessingRetryLimit", 3);
    const stale = await createQueuedJob("retry-limit", "PROCESSING");
    await prisma.mediaProcessingJob.update({ where: { id: stale.id }, data: { attempt: 3 } });
    expect(await queue.claimNext("worker-recovery")).toBeNull();
    const stored = await prisma.mediaProcessingJob.findUnique({ where: { id: stale.id } });
    expect(stored?.status).toBe("FAILED");
    expect(stored?.errorCode).toBe("STALE_WORKER_LEASE");
  });

  it("pauses new claims dynamically while leaving queued work intact", async () => {
    await setSetting("mediaProcessingEnabled", false);
    const queued = await createQueuedJob("paused");
    expect(await queue.claimNext("worker-a")).toBeNull();
    expect((await prisma.mediaProcessingJob.findUnique({ where: { id: queued.id } }))?.status).toBe(
      "QUEUED",
    );
    await setSetting("mediaProcessingEnabled", true);
    expect((await queue.claimNext("worker-a"))?.id).toBe(queued.id);
  });
});
''',
)

print("Media processing queue phase 1 patch applied.")
