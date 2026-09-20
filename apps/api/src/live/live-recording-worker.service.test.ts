import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../database/database.service.js";
import type { MediaProcessingLifecycleService } from "../media/media-processing-lifecycle.service.js";
import type { LiveIngestProvider } from "./live-provider.js";
import type { LiveRecordingHandoffService } from "./live-recording-handoff.service.js";
import { LiveRecordingWorkerService } from "./live-recording-worker.service.js";

describe("LiveRecordingWorkerService", () => {
  it("creates a VOD draft, links the R2 source, queues processing, then cleans up Mux", async () => {
    const stream = {
      id: "00000000-0000-4000-8000-000000000001",
      channelId: "00000000-0000-4000-8000-000000000002",
      slug: "task-73-live",
      title: "Task 73 live",
      description: "Recorded live session",
      providerRecordingAssetId: "mux-asset-1",
      recordingProviderDownloadUrl: "https://stream.mux.com/playback/highest.mp4",
      recordingHandoffStatus: "WAITING",
      recordingHandoffAttempt: 0,
      recordingHandoffStartedAt: null,
      recordingMediaAssetId: null,
      recordingR2ObjectKey: null,
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    };

    const liveUpdate = vi.fn(async () => ({ ...stream }));
    const transactionClient = {
      channelSettings: {
        findUnique: vi.fn(async () => ({
          defaultCommentsEnabled: true,
          defaultVideoVisibility: "PUBLIC",
        })),
      },
      video: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({
          id: "00000000-0000-4000-8000-000000000003",
          channelId: stream.channelId,
        })),
      },
      mediaAsset: {
        upsert: vi.fn(async () => ({
          id: "00000000-0000-4000-8000-000000000004",
        })),
      },
      liveStream: {
        update: liveUpdate,
      },
    };
    const database = {
      client: {
        liveStream: {
          findMany: vi.fn(async () => [stream]),
          updateMany: vi.fn(async () => ({ count: 1 })),
          findUnique: vi.fn(async () => stream),
          update: liveUpdate,
        },
        $transaction: vi.fn(async (operation: (tx: typeof transactionClient) => Promise<unknown>) =>
          operation(transactionClient),
        ),
      },
    } as unknown as DatabaseService;

    const provider = {
      configured: true,
      deleteRecordingAsset: vi.fn(async () => undefined),
    } as unknown as LiveIngestProvider;
    const handoff = {
      copy: vi.fn(
        async (_input: unknown, onProgress?: (uploadedBytes: number) => Promise<void>) => {
          await onProgress?.(512);
          return {
            r2ObjectKey:
              "channels/00000000-0000-4000-8000-000000000002/live/00000000-0000-4000-8000-000000000001/recordings/mux-asset-1.mp4",
            sizeBytes: 1024,
          };
        },
      ),
    } as unknown as LiveRecordingHandoffService;
    const processingLifecycle = {
      enqueueUploadedAsset: vi.fn(async () => ({ id: "processing-job-1" })),
    } as unknown as MediaProcessingLifecycleService;

    const worker = new LiveRecordingWorkerService(database, provider, handoff, processingLifecycle);

    await worker.runOnce();

    expect(transactionClient.video.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channelId: stream.channelId,
          title: stream.title,
          status: "UPLOADING",
          videoForm: "LONG_FORM",
        }),
      }),
    );
    expect(transactionClient.mediaAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          videoId: "00000000-0000-4000-8000-000000000003",
          status: "UPLOADED",
          mimeType: "video/mp4",
        }),
      }),
    );
    expect(processingLifecycle.enqueueUploadedAsset).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000004",
    );
    expect(database.client.liveStream.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: stream.id, recordingHandoffStatus: "COPYING" },
        data: { recordingHandoffHeartbeatAt: expect.any(Date) },
      }),
    );
    expect(provider.deleteRecordingAsset).toHaveBeenCalledWith("mux-asset-1");

    const cleanupOrder = (provider.deleteRecordingAsset as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const enqueueOrder = (processingLifecycle.enqueueUploadedAsset as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(enqueueOrder).toBeLessThan(cleanupOrder ?? Number.POSITIVE_INFINITY);
  });
});
