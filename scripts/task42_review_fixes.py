from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"anchor missing in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


service_path = Path("apps/api/src/media/media-adaptive-rollout.service.ts")
service = service_path.read_text()
if 'import type { Prisma } from "@ayin/db";' not in service:
    service = service.replace(
        'import { Inject, Injectable } from "@nestjs/common";\n',
        'import type { Prisma } from "@ayin/db";\nimport { Inject, Injectable } from "@nestjs/common";\n',
        1,
    )
service = service.replace(
    'const METRICS_WINDOW_DAYS = 30;\n',
    'const METRICS_WINDOW_DAYS = 30;\nconst ADAPTIVE_BACKFILL_ADVISORY_LOCK = 86192042;\nconst RECOVERY_SCAN_PAGE_SIZE = 25;\nconst RECOVERY_SCAN_MAX_ROWS = 250;\n',
    1,
)
start = service.index('  async enqueueBatch(')
end = service.index('  private async metrics()')
new_block = r'''  async enqueueBatch(requestedBatchSize?: number, actorAccountId?: string) {
    const controls = await this.controls();
    if (!controls.generationEnabled || !controls.backfillEnabled || controls.backfillPaused) {
      return { enqueued: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const, jobs: [] };
    }
    const requested = Number.isFinite(requestedBatchSize)
      ? Math.max(1, Math.floor(requestedBatchSize as number))
      : controls.batchSize;
    const batchSize = Math.min(requested, controls.batchSize, ADAPTIVE_BACKFILL_HARD_BATCH_MAX);
    const candidates = await this.pendingCandidates(batchSize * 4);

    return this.database.client.$transaction(async (tx) => {
      await this.lockBackfill(tx);
      const availableSlots = await this.availableBackfillSlots(tx, controls.maxInFlight);
      const take = Math.min(batchSize, availableSlots);
      if (take === 0) {
        const result = { enqueued: 0, reason: "IN_FLIGHT_LIMIT" as const, jobs: [] };
        await this.auditMutation(tx, actorAccountId, "media_adaptive.backfill_batch", {
          requestedBatchSize: requestedBatchSize ?? null,
          enqueued: 0,
          reason: result.reason,
        });
        return result;
      }

      const jobs = [];
      for (const candidate of candidates) {
        if (jobs.length >= take) break;
        const job = await this.lifecycle.createAdaptiveBackfillJob(tx, candidate.id);
        if (job) jobs.push(job);
      }
      const result = {
        enqueued: jobs.length,
        reason: jobs.length ? ("ENQUEUED" as const) : ("NO_ELIGIBLE_VIDEO" as const),
        jobs,
      };
      await this.auditMutation(tx, actorAccountId, "media_adaptive.backfill_batch", {
        requestedBatchSize: requestedBatchSize ?? null,
        enqueued: result.enqueued,
        reason: result.reason,
      });
      return result;
    });
  }

  async setPaused(paused: boolean, actorAccountId?: string) {
    await this.database.client.$transaction(async (tx) => {
      await this.settings.setInTransaction(tx, "mediaHlsBackfillPaused", paused);
      await this.auditMutation(
        tx,
        actorAccountId,
        paused ? "media_adaptive.backfill_pause" : "media_adaptive.backfill_resume",
        { paused },
      );
    });
    return this.controls();
  }

  async recover(
    mode: AdaptiveRecoveryMode,
    requestedBatchSize?: number,
    actorAccountId?: string,
    cursor?: string,
  ) {
    const controls = await this.controls();
    const batchSize = Math.min(
      Math.max(1, Math.floor(requestedBatchSize ?? controls.batchSize)),
      ADAPTIVE_BACKFILL_HARD_BATCH_MAX,
    );

    if (mode === "STALE_PROCESSING") {
      const stale = await this.queue.recoverStale(async (tx, result) => {
        await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
          mode,
          requestedBatchSize: requestedBatchSize ?? null,
          recovered: result.recovered,
        });
      });
      return { mode, ...stale };
    }

    if (!controls.generationEnabled || !controls.backfillEnabled || controls.backfillPaused) {
      return { mode, recovered: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const };
    }

    if (mode === "FAILED_BACKFILL") {
      return this.database.client.$transaction(async (tx) => {
        await this.lockBackfill(tx);
        const availableSlots = await this.availableBackfillSlots(tx, controls.maxInFlight);
        if (availableSlots === 0) {
          const result = { mode, recovered: 0, reason: "IN_FLIGHT_LIMIT" as const };
          await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
            mode,
            requestedBatchSize: requestedBatchSize ?? null,
            recovered: 0,
            reason: result.reason,
          });
          return result;
        }
        const failed = await tx.mediaProcessingJob.findMany({
          where: { stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER }, status: "FAILED" },
          orderBy: { updatedAt: "asc" },
          take: Math.min(batchSize, availableSlots),
          select: { id: true },
        });
        let recovered = 0;
        for (const job of failed) {
          const changed = await tx.mediaProcessingJob.updateMany({
            where: { id: job.id, status: "FAILED" },
            data: {
              status: "QUEUED",
              stage: "ADAPTIVE_BACKFILL_RETRY_QUEUED",
              progressPercent: 0,
              attempt: 0,
              queuedAt: new Date(),
              startedAt: null,
              completedAt: null,
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: null,
              errorMessage: null,
            },
          });
          recovered += changed.count;
        }
        await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
          mode,
          requestedBatchSize: requestedBatchSize ?? null,
          recovered,
        });
        return { mode, recovered };
      });
    }

    if (mode === "DB_MANIFEST_MISSING") {
      const scan = await this.findMissingManifestRows(batchSize, cursor);
      return this.database.client.$transaction(async (tx) => {
        await this.lockBackfill(tx);
        const availableSlots = await this.availableBackfillSlots(tx, controls.maxInFlight);
        let detected = 0;
        let requeued = 0;
        for (const row of scan.rows) {
          const changed = await tx.mediaPlaybackGeneration.updateMany({
            where: { id: row.id, status: "READY", hlsMasterStatus: "READY" },
            data: {
              status: "FAILED",
              hlsMasterStatus: "FAILED",
              failedAt: new Date(),
              readyAt: null,
            },
          });
          if (changed.count !== 1) continue;
          detected += 1;
          if (requeued >= availableSlots) continue;
          const job = await this.lifecycle.createAdaptiveBackfillJob(tx, row.videoId);
          if (job) requeued += 1;
        }
        await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
          mode,
          requestedBatchSize: requestedBatchSize ?? null,
          detected,
          requeued,
          scanned: scan.scanned,
        });
        return {
          mode,
          detected,
          requeued,
          scanned: scan.scanned,
          nextCursor: scan.nextCursor,
          ...(availableSlots === 0 ? { reason: "IN_FLIGHT_LIMIT" as const } : {}),
        };
      });
    }

    if (mode === "INCOMPLETE_HLS") {
      const rows = await this.database.client.mediaPlaybackGeneration.findMany({
        where: {
          status: { in: ["BUILDING", "FAILED"] },
          updatedAt: { lt: new Date(Date.now() - RECOVERY_STALE_MS) },
        },
        orderBy: { updatedAt: "asc" },
        take: Math.min(batchSize * 4, RECOVERY_SCAN_MAX_ROWS),
        select: { id: true, videoId: true },
      });
      const uniqueRows = rows.filter(
        (row, index, all) => all.findIndex((candidate) => candidate.videoId === row.videoId) === index,
      );
      return this.database.client.$transaction(async (tx) => {
        await this.lockBackfill(tx);
        const availableSlots = await this.availableBackfillSlots(tx, controls.maxInFlight);
        let requeued = 0;
        for (const row of uniqueRows) {
          if (requeued >= Math.min(batchSize, availableSlots)) break;
          const job = await this.lifecycle.createAdaptiveBackfillJob(tx, row.videoId);
          if (!job) continue;
          requeued += 1;
          await tx.mediaPlaybackGeneration.updateMany({
            where: { id: row.id, status: { in: ["BUILDING", "FAILED"] } },
            data: { status: "SUPERSEDED" },
          });
        }
        await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
          mode,
          requestedBatchSize: requestedBatchSize ?? null,
          detected: uniqueRows.length,
          requeued,
        });
        return {
          mode,
          detected: uniqueRows.length,
          requeued,
          ...(availableSlots === 0 ? { reason: "IN_FLIGHT_LIMIT" as const } : {}),
        };
      });
    }

    const scan = await this.findVerifiedHlsMissingDb(batchSize, cursor);
    return this.database.client.$transaction(async (tx) => {
      await this.lockBackfill(tx);
      const availableSlots = await this.availableBackfillSlots(tx, controls.maxInFlight);
      let requeued = 0;
      for (const video of scan.videos) {
        if (requeued >= Math.min(batchSize, availableSlots)) break;
        const job = await this.lifecycle.createAdaptiveBackfillJob(tx, video.id);
        if (job) requeued += 1;
      }
      await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
        mode,
        requestedBatchSize: requestedBatchSize ?? null,
        detected: scan.videos.length,
        requeued,
        scanned: scan.scanned,
      });
      return {
        mode,
        detected: scan.videos.length,
        requeued,
        scanned: scan.scanned,
        nextCursor: scan.nextCursor,
        policy: "REPROCESS_VERIFIED_ORPHAN_IN_NEW_GENERATION",
        ...(availableSlots === 0 ? { reason: "IN_FLIGHT_LIMIT" as const } : {}),
      };
    });
  }

  private async findMissingManifestRows(batchSize: number, cursor?: string) {
    const missing: Array<{ id: string; videoId: string; hlsMasterR2ObjectKey: string }> = [];
    let nextCursor = cursor ?? null;
    let scanned = 0;
    let exhausted = false;

    while (missing.length < batchSize && scanned < RECOVERY_SCAN_MAX_ROWS && !exhausted) {
      const take = Math.min(RECOVERY_SCAN_PAGE_SIZE, RECOVERY_SCAN_MAX_ROWS - scanned);
      const rows = await this.database.client.mediaPlaybackGeneration.findMany({
        where: { status: "READY", hlsMasterStatus: "READY" },
        orderBy: { id: "asc" },
        take,
        ...(nextCursor ? { cursor: { id: nextCursor }, skip: 1 } : {}),
        select: { id: true, videoId: true, hlsMasterR2ObjectKey: true },
      });
      if (rows.length === 0) {
        exhausted = true;
        break;
      }
      for (const row of rows) {
        nextCursor = row.id;
        scanned += 1;
        if (!(await this.objectExists(row.hlsMasterR2ObjectKey))) missing.push(row);
        if (missing.length >= batchSize || scanned >= RECOVERY_SCAN_MAX_ROWS) break;
      }
      if (rows.length < take) exhausted = true;
    }

    return { rows: missing, scanned, nextCursor: exhausted ? null : nextCursor };
  }

  private async findVerifiedHlsMissingDb(batchSize: number, cursor?: string) {
    const candidates = await this.pendingCandidates(RECOVERY_SCAN_MAX_ROWS, cursor);
    const videos: CatalogVideo[] = [];
    let scanned = 0;
    let nextCursor: string | null = cursor ?? null;

    for (const video of candidates) {
      nextCursor = video.id;
      scanned += 1;
      const latestJob = await this.database.client.mediaProcessingJob.findFirst({
        where: { videoId: video.id },
        orderBy: { generation: "desc" },
        select: { generation: true },
      });
      if (!latestJob) continue;
      const generationRow = await this.database.client.mediaPlaybackGeneration.findUnique({
        where: { videoId_generation: { videoId: video.id, generation: latestJob.generation } },
        select: { id: true },
      });
      if (generationRow) continue;
      const manifestKey = hlsMasterObjectKey({
        channelId: video.channelId,
        videoId: video.id,
        generation: latestJob.generation,
      });
      if (!(await this.objectExists(manifestKey))) continue;
      videos.push(video);
      if (videos.length >= batchSize) break;
    }

    const exhausted = candidates.length < RECOVERY_SCAN_MAX_ROWS && scanned === candidates.length;
    return { videos, scanned, nextCursor: exhausted ? null : nextCursor };
  }

  private async lockBackfill(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock($1)",
      ADAPTIVE_BACKFILL_ADVISORY_LOCK,
    );
  }

  private async availableBackfillSlots(
    tx: Prisma.TransactionClient,
    maxInFlight: number,
  ): Promise<number> {
    const inFlight = await tx.mediaProcessingJob.count({
      where: {
        stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER },
        status: { in: [...ACTIVE_OR_QUEUED] },
      },
    });
    return Math.max(0, maxInFlight - inFlight);
  }

  private async auditMutation(
    tx: Prisma.TransactionClient,
    actorAccountId: string | undefined,
    action: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    if (!actorAccountId) return;
    await tx.adminAuditLog.create({
      data: {
        actorAccountId,
        action,
        entityType: "AdaptiveStreamingRollout",
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  }

'''
service = service[:start] + new_block + service[end:]

# Add cursor support to pending candidate scanning.
old_pending = r'''  private async pendingCandidates(limit: number): Promise<CatalogVideo[]> {
    const videos = await this.catalogVideos();
    if (!videos.length) return [];
    const ready = await this.database.client.mediaPlaybackGeneration.findMany({
      where: {
        videoId: { in: videos.map((video) => video.id) },
        status: "READY",
        fallbackStatus: "READY",
        hlsMasterStatus: "READY",
        renditions: { some: { status: "READY", protocol: "HLS" } },
      },
      distinct: ["videoId"],
      select: { videoId: true },
    });
    const active = await this.database.client.mediaProcessingJob.findMany({
      where: {
        videoId: { in: videos.map((video) => video.id) },
        status: { in: [...ACTIVE_OR_QUEUED] },
      },
      distinct: ["videoId"],
      select: { videoId: true },
    });
    const blocked = new Set([
      ...ready.map((row) => row.videoId),
      ...active.map((row) => row.videoId),
    ]);
    return videos.filter((video) => !blocked.has(video.id)).slice(0, limit);
  }
'''
new_pending = r'''  private async pendingCandidates(limit: number, afterVideoId?: string): Promise<CatalogVideo[]> {
    const videos = await this.catalogVideos();
    if (!videos.length) return [];
    const cursorIndex = afterVideoId ? videos.findIndex((video) => video.id === afterVideoId) : -1;
    const pool = cursorIndex >= 0 ? videos.slice(cursorIndex + 1) : videos;
    if (!pool.length) return [];
    const poolIds = pool.map((video) => video.id);
    const ready = await this.database.client.mediaPlaybackGeneration.findMany({
      where: {
        videoId: { in: poolIds },
        status: "READY",
        fallbackStatus: "READY",
        hlsMasterStatus: "READY",
        renditions: { some: { status: "READY", protocol: "HLS" } },
      },
      distinct: ["videoId"],
      select: { videoId: true },
    });
    const active = await this.database.client.mediaProcessingJob.findMany({
      where: {
        videoId: { in: poolIds },
        status: { in: [...ACTIVE_OR_QUEUED] },
      },
      distinct: ["videoId"],
      select: { videoId: true },
    });
    const blocked = new Set([
      ...ready.map((row) => row.videoId),
      ...active.map((row) => row.videoId),
    ]);
    return pool.filter((video) => !blocked.has(video.id)).slice(0, limit);
  }
'''
if old_pending not in service:
    raise SystemExit("pendingCandidates anchor missing")
service = service.replace(old_pending, new_pending, 1)
service_path.write_text(service)

# Queue stale recovery gets a transaction callback so Task 42 can audit in the same commit.
queue_path = Path("apps/api/src/media/media-processing-queue.service.ts")
queue = queue_path.read_text()
old_queue = r'''  async recoverStale() {
    return this.database.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1)", QUEUE_ADVISORY_LOCK);
      const capacity = await this.capacityInTransaction(tx);
      const now = new Date();
      const recovered = await tx.mediaProcessingJob.count({
        where: { status: { in: [...ACTIVE_STATUSES] }, leaseExpiresAt: { lt: now } },
      });
      await this.recoverStaleInTransaction(tx, now, capacity.retryLimit);
      return { recovered };
    });
  }
'''
new_queue = r'''  async recoverStale(
    onRecovered?: (
      tx: Prisma.TransactionClient,
      result: { recovered: number },
    ) => Promise<void>,
  ) {
    return this.database.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1)", QUEUE_ADVISORY_LOCK);
      const capacity = await this.capacityInTransaction(tx);
      const now = new Date();
      const recovered = await tx.mediaProcessingJob.count({
        where: { status: { in: [...ACTIVE_STATUSES] }, leaseExpiresAt: { lt: now } },
      });
      await this.recoverStaleInTransaction(tx, now, capacity.retryLimit);
      const result = { recovered };
      await onRecovered?.(tx, result);
      return result;
    });
  }
'''
if old_queue not in queue:
    raise SystemExit("recoverStale queue anchor missing")
queue_path.write_text(queue.replace(old_queue, new_queue, 1))

# Controller delegates Task 42 audit to the service's transaction and protects superadmin-only pause state.
controller_path = Path("apps/api/src/admin/admin-media-processing.controller.ts")
controller = controller_path.read_text()
controller = controller.replace(
    'const recoverySchema = z\n  .object({\n    mode: z.enum(ADAPTIVE_RECOVERY_MODES),\n    batchSize: z.number().int().min(1).max(20).optional(),\n  })',
    'const recoverySchema = z\n  .object({\n    mode: z.enum(ADAPTIVE_RECOVERY_MODES),\n    batchSize: z.number().int().min(1).max(20).optional(),\n    cursor: uuidSchema.optional(),\n  })',
    1,
)
controller = controller.replace(
    '    const result = await this.adaptiveRollout.enqueueBatch(parsed.data.batchSize);\n    await this.auditAdaptive(request, "media_adaptive.backfill_batch", {\n      requestedBatchSize: parsed.data.batchSize ?? null,\n      enqueued: result.enqueued,\n      reason: result.reason,\n    });\n',
    '    const result = await this.adaptiveRollout.enqueueBatch(\n      parsed.data.batchSize,\n      request.ayinAuth.accountId,\n    );\n',
    1,
)
controller = controller.replace(
    '  @Post("adaptive-rollout/backfill/pause")\n  async pauseAdaptiveBackfill(@Req() request: AdminAuthenticatedRequest) {\n    const controls = await this.adaptiveRollout.setPaused(true);\n    await this.auditAdaptive(request, "media_adaptive.backfill_pause", {});\n    return controls;\n  }\n\n  @Post("adaptive-rollout/backfill/resume")\n  async resumeAdaptiveBackfill(@Req() request: AdminAuthenticatedRequest) {\n    const controls = await this.adaptiveRollout.setPaused(false);\n    await this.auditAdaptive(request, "media_adaptive.backfill_resume", {});\n    return controls;\n  }\n',
    '  @Post("adaptive-rollout/backfill/pause")\n  @RequireAdminRoles("SUPERADMIN")\n  async pauseAdaptiveBackfill(@Req() request: AdminAuthenticatedRequest) {\n    return this.adaptiveRollout.setPaused(true, request.ayinAuth.accountId);\n  }\n\n  @Post("adaptive-rollout/backfill/resume")\n  @RequireAdminRoles("SUPERADMIN")\n  async resumeAdaptiveBackfill(@Req() request: AdminAuthenticatedRequest) {\n    return this.adaptiveRollout.setPaused(false, request.ayinAuth.accountId);\n  }\n',
    1,
)
controller = controller.replace(
    '    const result = await this.adaptiveRollout.recover(parsed.data.mode, parsed.data.batchSize);\n    await this.auditAdaptive(request, "media_adaptive.recovery", {\n      mode: parsed.data.mode,\n      requestedBatchSize: parsed.data.batchSize ?? null,\n    });\n    return result;\n',
    '    return this.adaptiveRollout.recover(\n      parsed.data.mode,\n      parsed.data.batchSize,\n      request.ayinAuth.accountId,\n      parsed.data.cursor,\n    );\n',
    1,
)
# Remove the now-unused Task 42 post-commit audit helper only; existing retry/reprocess audit remains.
audit_start = controller.find('  private async auditAdaptive(')
if audit_start >= 0:
    audit_end = controller.find('  private uuid(', audit_start)
    if audit_end < 0:
        raise SystemExit("auditAdaptive end anchor missing")
    controller = controller[:audit_start] + controller[audit_end:]
controller_path.write_text(controller)

# Expand rollout safety tests with serialized capacity / recovery ceiling behavior using transaction mocks.
test_path = Path("apps/api/src/media/media-adaptive-rollout.service.test.ts")
test = test_path.read_text()
if 'serializes backfill capacity checks before creating jobs' not in test:
    insertion = r'''

  it("serializes backfill capacity checks before creating jobs", async () => {
    const jobs = { count: vi.fn().mockResolvedValue(1) };
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      mediaProcessingJob: jobs,
      adminAuditLog: { create: vi.fn() },
    };
    const database = {
      client: {
        mediaProcessingJob: jobs,
        mediaPlaybackGeneration: { findMany: vi.fn().mockResolvedValue([]) },
        video: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      },
    };
    const service = new MediaAdaptiveRolloutService(
      database as never,
      {} as never,
      {} as never,
      { createAdaptiveBackfillJob: vi.fn() } as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, "controls").mockResolvedValue({ ...baseControls, maxInFlight: 1 });

    const result = await service.enqueueBatch(2);

    expect(result.reason).toBe("IN_FLIGHT_LIMIT");
    expect(tx.$executeRawUnsafe).toHaveBeenCalled();
  });

  it("caps failed backfill recovery by the remaining in-flight slots", async () => {
    const failed = [{ id: "11111111-1111-4111-8111-111111111111" }];
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      mediaProcessingJob: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue(failed),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      adminAuditLog: { create: vi.fn() },
    };
    const database = {
      client: {
        $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      },
    };
    const service = new MediaAdaptiveRolloutService(
      database as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, "controls").mockResolvedValue({ ...baseControls, maxInFlight: 1 });

    const result = await service.recover("FAILED_BACKFILL", 20);

    expect(result).toEqual({ mode: "FAILED_BACKFILL", recovered: 1 });
    expect(tx.mediaProcessingJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });
'''
    closing = '\n});\n'
    if not test.endswith(closing):
        raise SystemExit("rollout test closing anchor missing")
    test = test[:-len(closing)] + insertion + closing
    test_path.write_text(test)

print("Task 42 review fixes applied")
