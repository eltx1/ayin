import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lockOwnedMediaJob } from "./media-processing-integrity-fence.js";
import {
  autoThumbnailObjectKey,
  autoThumbnailSeekSeconds,
  MediaAutoThumbnailService,
} from "./media-auto-thumbnail.service.js";
vi.mock("./media-processing-integrity-fence.js", () => ({ lockOwnedMediaJob: vi.fn() }));
const directories: string[] = [];
beforeEach(() => {
  vi.mocked(lockOwnedMediaJob).mockReset();
  vi.mocked(lockOwnedMediaJob).mockResolvedValue({
    id: "job",
    videoId: "video-1",
    video: { channelId: "channel-1" },
  } as never);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const input = {
  jobId: "job",
  workerId: "claim",
  videoId: "video-1",
  canonicalPath: "/tmp/canonical.mp4",
  durationMs: 60000,
};

describe("automatic video thumbnails", () => {
  it("uses the existing deterministic SEO thumbnail key", () => {
    expect(autoThumbnailObjectKey("channel-1", "video-1")).toBe(
      "channels/channel-1/videos/video-1/seo/auto-thumbnail.jpg",
    );
  });
  it("samples early and caps the seek at three seconds", () => {
    expect(autoThumbnailSeekSeconds(null)).toBe(0);
    expect(autoThumbnailSeekSeconds(1000)).toBeCloseTo(0.1);
    expect(autoThumbnailSeekSeconds(10000)).toBeCloseTo(1);
    expect(autoThumbnailSeekSeconds(600000)).toBe(3);
  });
  it.each(["PENDING", "UPLOADED", "VALIDATED"] as const)(
    "preserves an existing %s creator thumbnail under current ownership",
    async (status) => {
      const findFirst = vi
        .fn()
        .mockResolvedValue({ id: "manual", status, r2ObjectKey: "manual-thumb" });
      const tx = { mediaAsset: { findFirst } };
      const uploadFile = vi.fn();
      const service = new MediaAutoThumbnailService(
        { client: { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } } as never,
        { uploadFile } as never,
      );
      await expect(service.ensureForCanonical(input)).resolves.toMatchObject({
        created: false,
        assetId: "manual",
        reason: "existing-thumbnail",
      });
      expect(lockOwnedMediaJob).toHaveBeenCalledWith(
        tx,
        "job",
        "claim",
        expect.objectContaining({
          requireInput: true,
          requireOutput: true,
          lockThumbnails: true,
        }),
      );
      expect(uploadFile).not.toHaveBeenCalled();
    },
  );
  it("preserves an existing VALIDATED automatic thumbnail without a replacement or upload", async () => {
    const tx = {
      mediaAsset: {
        findFirst: vi.fn().mockResolvedValue({
          id: "automatic",
          status: "VALIDATED",
          r2ObjectKey: autoThumbnailObjectKey("channel-1", "video-1"),
        }),
        upsert: vi.fn(),
      },
    };
    const storage = { uploadFile: vi.fn() };
    const service = new MediaAutoThumbnailService(
      { client: { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } } as never,
      storage as never,
    );
    await expect(service.ensureForCanonical(input)).resolves.toMatchObject({
      created: false,
      assetId: "automatic",
    });
    expect(tx.mediaAsset.upsert).not.toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });
  for (const loseAt of [0, 2, 3])
    it(`reserves before I/O and refuses stale eligibility at fence ${loseAt}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "ayin-thumbnail-fence-"));
      directories.push(directory);
      const trace: string[] = [];
      let state = "NONE";
      const tx = {
        $executeRaw: vi.fn(async () => {
          state = "VALIDATED";
          return 1;
        }),
        mediaAsset: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn(async () => {
            state = "PENDING";
            trace.push("reserved");
            return { id: "reserved" };
          }),
          updateMany: vi.fn(async ({ data }: { data: { status?: string } }) => {
            if (data.status) state = data.status;
            return { count: 1 };
          }),
        },
      };
      let fence = 0;
      vi.mocked(lockOwnedMediaJob).mockImplementation(async () => {
        fence++;
        return (
          fence === loseAt
            ? null
            : { id: "job", videoId: "video-1", video: { channelId: "channel-1" } }
        ) as never;
      });
      const storage = {
        uploadFile: vi.fn(async () => {
          expect(state).toBe("PENDING");
          trace.push("uploaded");
        }),
        deleteObject: vi.fn(),
      };
      const service = new MediaAutoThumbnailService(
        { client: { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } } as never,
        storage as never,
      );
      vi.spyOn(
        service as unknown as {
          extractFrame(canonicalPath: string, thumbnailPath: string): Promise<void>;
        },
        "extractFrame",
      ).mockImplementation(async (_canonical, path) => {
        expect(state).toBe("PENDING");
        trace.push("extracted");
        await writeFile(path, "jpeg");
      });
      const work = service.ensureForCanonical({
        ...input,
        canonicalPath: join(directory, "canonical.mp4"),
      });
      if (loseAt) {
        await expect(work).rejects.toThrow(/authority/);
        expect(state).toBe("PENDING");
      } else {
        await expect(work).resolves.toMatchObject({ created: true, assetId: "reserved" });
        expect(state).toBe("VALIDATED");
      }
      expect(trace[0]).toBe("reserved");
      if (loseAt === 2) expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
});
