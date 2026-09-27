import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AdminAuditLogService } from "../src/admin/admin-audit-log.service.js";
import { AdminMediaProcessingController } from "../src/admin/admin-media-processing.controller.js";
import type { AdminAuthenticatedRequest } from "../src/admin/admin.guard.js";
import type { DatabaseService } from "../src/database/database.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("administrator media retry transaction safety", () => {
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fixture() {
    const actor = await prisma.account.create({
      data: { email: "media-retry@example.test", displayName: "Retry operator" },
    });
    const channel = await prisma.channel.create({
      data: { handle: "retry-safety", name: "Retry safety", status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: { channelId: channel.id, slug: "retry-safety", title: "Retry safety" },
    });
    const job = await prisma.mediaProcessingJob.create({
      data: {
        videoId: video.id,
        generation: 1,
        status: "FAILED",
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1024n,
        stagingKey: `staging/${video.id}/source.mp4`,
        outputR2ObjectKey: `channels/${channel.id}/${video.id}/g1.mp4`,
        attempt: 3,
        leaseOwner: "old-worker:old-claim",
        leaseWorkerId: "old-worker",
        leaseExpiresAt: new Date(0),
        completedAt: new Date(),
        errorCode: "PROCESSING_FAILED",
        updatedAt: new Date(0),
      },
    });
    const request = { ayinAuth: { accountId: actor.id } } as AdminAuthenticatedRequest;
    return { job, request };
  }

  // Only pause completed reads; writes, transactions and audits use real PostgreSQL.
  // This deterministically recreates two stale FAILED snapshots without timing sleeps.
  function controller(afterRead: () => Promise<void>) {
    const client = prisma.$extends({
      query: {
        mediaProcessingJob: {
          async findUnique({ args, query }) {
            const result = await query(args);
            await afterRead();
            return result;
          },
        },
      },
    });
    const database = { client } as unknown as DatabaseService;
    return new AdminMediaProcessingController(
      database,
      {} as never,
      {} as never,
      {} as never,
      new AdminAuditLogService(database),
    );
  }

  it("allows one concurrent retry and commits exactly one audit record", async () => {
    const { job, request } = await fixture();
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const subject = controller(async () => {
      reads += 1;
      if (reads === 2) release();
      await barrier;
    });
    const results = await Promise.allSettled([
      subject.retryFailed(request, job.id),
      subject.retryFailed(request, job.id),
    ]);
    expect(reads).toBe(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.getResponse()).toMatchObject({
      error: { code: "MEDIA_JOB_RETRY_CONFLICT" },
    });
    expect(
      await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: "QUEUED",
      attempt: 0,
      leaseOwner: null,
      leaseWorkerId: null,
      leaseExpiresAt: null,
      completedAt: null,
      errorCode: null,
    });
    expect(
      await prisma.adminAuditLog.count({
        where: { action: "media_processing.retry", entityId: job.id },
      }),
    ).toBe(1);
  });

  it("does not overwrite a worker lease acquired after the FAILED snapshot", async () => {
    const { job, request } = await fixture();
    const leaseExpiresAt = new Date(Date.now() + 60_000);
    const subject = controller(async () => {
      // Represents another recovery followed by a successful worker claim.
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          status: "PROCESSING",
          leaseOwner: "new-worker:new-claim",
          leaseWorkerId: "new-worker",
          leaseExpiresAt,
          attempt: 1,
        },
      });
    });
    await expect(subject.retryFailed(request, job.id)).rejects.toMatchObject({
      response: { error: { code: "MEDIA_JOB_RETRY_CONFLICT" } },
    });
    expect(
      await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: "PROCESSING",
      leaseOwner: "new-worker:new-claim",
      leaseWorkerId: "new-worker",
      leaseExpiresAt,
      attempt: 1,
    });
    expect(await prisma.adminAuditLog.count({ where: { entityId: job.id } })).toBe(0);
  });

  it("rejects a stale snapshot even when the job has failed again", async () => {
    const { job, request } = await fixture();
    const subject = controller(async () => {
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { errorCode: "NEW_FAILURE", attempt: 4 },
      });
    });
    await expect(subject.retryFailed(request, job.id)).rejects.toMatchObject({
      response: { error: { code: "MEDIA_JOB_RETRY_CONFLICT" } },
    });
    expect(
      await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: "FAILED",
      errorCode: "NEW_FAILURE",
      attempt: 4,
    });
    expect(await prisma.adminAuditLog.count({ where: { entityId: job.id } })).toBe(0);
  });

  it("rolls back the retry if its audit record cannot be committed", async () => {
    const { job, request } = await fixture();
    request.ayinAuth.accountId = randomUUID(); // Violates the real audit actor foreign key.
    await expect(controller(async () => {}).retryFailed(request, job.id)).rejects.toMatchObject({
      code: "P2003",
    });
    expect(await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).toEqual(
      job,
    );
    expect(await prisma.adminAuditLog.count({ where: { entityId: job.id } })).toBe(0);
  });
});
