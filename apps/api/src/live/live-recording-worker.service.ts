import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  LIVE_INGEST_PROVIDER,
  type LiveIngestProvider,
} from "./live-provider.js";
import { LiveRecordingHandoffService } from "./live-recording-handoff.service.js";

const POLL_INTERVAL_MS = 30_000;
const STALE_COPY_AFTER_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class LiveRecordingWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(LIVE_INGEST_PROVIDER) private readonly provider: LiveIngestProvider,
    @Inject(LiveRecordingHandoffService)
    private readonly handoff: LiveRecordingHandoffService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runOnce(), POLL_INTERVAL_MS);
    this.timer.unref();
    void this.runOnce();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const staleBefore = new Date(Date.now() - STALE_COPY_AFTER_MS);
      const candidates = await this.database.client.liveStream.findMany({
        where: {
          OR: [
            {
              recordingHandoffStatus: { in: ["WAITING", "FAILED"] },
              recordingProviderDownloadUrl: { not: null },
              recordingHandoffAttempt: { lt: MAX_ATTEMPTS },
            },
            {
              recordingHandoffStatus: "COPYING",
              recordingProviderDownloadUrl: { not: null },
              recordingHandoffStartedAt: { lt: staleBefore },
              recordingHandoffAttempt: { lt: MAX_ATTEMPTS },
            },
            {
              recordingHandoffStatus: "CLEANUP_PENDING",
              providerRecordingAssetId: { not: null },
            },
          ],
        },
        orderBy: { updatedAt: "asc" },
        take: 4,
      });

      for (const stream of candidates) {
        if (stream.recordingHandoffStatus === "CLEANUP_PENDING") {
          await this.cleanupProviderAsset(stream.id, stream.providerRecordingAssetId);
          continue;
        }
        await this.copyRecording(stream.id);
      }
    } finally {
      this.running = false;
    }
  }

  private async copyRecording(streamId: string): Promise<void> {
    const claimed = await this.database.client.liveStream.updateMany({
      where: {
        id: streamId,
        recordingProviderDownloadUrl: { not: null },
        recordingHandoffAttempt: { lt: MAX_ATTEMPTS },
        OR: [
          { recordingHandoffStatus: { in: ["WAITING", "FAILED"] } },
          {
            recordingHandoffStatus: "COPYING",
            recordingHandoffStartedAt: {
              lt: new Date(Date.now() - STALE_COPY_AFTER_MS),
            },
          },
        ],
      },
      data: {
        recordingHandoffStatus: "COPYING",
        recordingHandoffStartedAt: new Date(),
        recordingHandoffAttempt: { increment: 1 },
        recordingHandoffError: null,
      },
    });
    if (claimed.count !== 1) return;

    const stream = await this.database.client.liveStream.findUnique({ where: { id: streamId } });
    if (
      !stream ||
      !stream.providerRecordingAssetId ||
      !stream.recordingProviderDownloadUrl
    ) {
      return;
    }

    try {
      const copied = await this.handoff.copy({
        streamId: stream.id,
        channelId: stream.channelId,
        providerAssetId: stream.providerRecordingAssetId,
        downloadUrl: stream.recordingProviderDownloadUrl,
      });

      await this.database.client.$transaction(async (transaction) => {
        const mediaAsset = await transaction.mediaAsset.upsert({
          where: { r2ObjectKey: copied.r2ObjectKey },
          create: {
            channelId: stream.channelId,
            kind: "SOURCE_VIDEO",
            status: "UPLOADED",
            r2ObjectKey: copied.r2ObjectKey,
            mimeType: "video/mp4",
            sizeBytes: BigInt(copied.sizeBytes),
          },
          update: {
            status: "UPLOADED",
            sizeBytes: BigInt(copied.sizeBytes),
            removedAt: null,
          },
        });
        await transaction.liveStream.update({
          where: { id: stream.id },
          data: {
            recordingHandoffStatus: "CLEANUP_PENDING",
            recordingR2ObjectKey: copied.r2ObjectKey,
            recordingMediaAssetId: mediaAsset.id,
            recordingHandoffAt: new Date(),
            recordingHandoffError: null,
          },
        });
      });
      await this.cleanupProviderAsset(stream.id, stream.providerRecordingAssetId);
    } catch (error) {
      const message = safeErrorMessage(error, "Live recording handoff failed.");
      await this.database.client.liveStream.update({
        where: { id: stream.id },
        data: {
          recordingHandoffStatus: "FAILED",
          recordingHandoffError: message,
        },
      });
    }
  }

  private async cleanupProviderAsset(
    streamId: string,
    providerAssetId: string | null,
  ): Promise<void> {
    if (!providerAssetId || !this.provider.configured) return;
    try {
      await this.provider.deleteRecordingAsset(providerAssetId);
      await this.database.client.liveStream.update({
        where: { id: streamId },
        data: {
          recordingHandoffStatus: "READY",
          recordingProviderDeletedAt: new Date(),
          recordingProviderDownloadUrl: null,
          recordingHandoffError: null,
        },
      });
    } catch (error) {
      await this.database.client.liveStream.update({
        where: { id: streamId },
        data: {
          recordingHandoffStatus: "CLEANUP_PENDING",
          recordingHandoffError: safeErrorMessage(error, "Mux recording cleanup failed."),
        },
      });
    }
  }
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.slice(0, 500) : fallback;
}
