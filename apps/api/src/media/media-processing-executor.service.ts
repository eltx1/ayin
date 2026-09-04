import { execFile, spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import type { MediaProcessingJob } from "@ayin/db";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { MediaProcessingLifecycleService } from "./media-processing-lifecycle.service.js";
import { MediaProcessingQueueService } from "./media-processing-queue.service.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";

const execFileAsync = promisify(execFile);

interface ProbeMetadata {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

@Injectable()
export class MediaProcessingExecutorService {
  private readonly logger = new Logger(MediaProcessingExecutorService.name);
  private readonly workRoot: string;
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;

  constructor(
    @Inject(MediaProcessingQueueService) private readonly queue: MediaProcessingQueueService,
    @Inject(MediaProcessingLifecycleService)
    private readonly lifecycle: MediaProcessingLifecycleService,
    @Inject(MediaProcessingStorageService) private readonly storage: MediaProcessingStorageService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {
    this.workRoot = process.env.MEDIA_PROCESSING_WORKDIR?.trim() || "/tmp/ayin-media-processing";
    if (!isAbsolute(this.workRoot)) {
      throw new Error("MEDIA_PROCESSING_WORKDIR must be an absolute path.");
    }
    this.ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    this.ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  }

  async process(job: MediaProcessingJob, workerId: string): Promise<void> {
    const workDirectory = join(this.workRoot, job.id);
    const inputPath = join(workDirectory, `input${sourceExtension(job.sourceMimeType)}`);
    const outputPath = join(workDirectory, "canonical.mp4");
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      await rm(workDirectory, { recursive: true, force: true });
      await mkdir(workDirectory, { recursive: true });
      heartbeatTimer = setInterval(() => {
        void this.queue.heartbeat(job.id, workerId).catch((error: unknown) => {
          this.logger.warn(`Heartbeat failed for media job ${job.id}: ${errorMessage(error)}`);
        });
      }, 30_000);
      heartbeatTimer.unref();

      const existingOutput = await this.tryHead(job.outputR2ObjectKey);
      let canonicalMetadata: ProbeMetadata;

      if (isVerifiedCanonical(existingOutput)) {
        await this.requireOwnedStage(job.id, workerId, "VERIFYING", "RECOVERING_FINAL_OBJECT", 90);
        await this.storage.downloadToFile(job.outputR2ObjectKey, outputPath);
        canonicalMetadata = await this.probe(outputPath);
      } else {
        if (!job.inputR2ObjectKey)
          throw new Error("The processing job has no input R2 object key.");
        await this.requireOwnedStage(job.id, workerId, "PROCESSING", "DOWNLOADING_SOURCE", 5);
        await this.storage.downloadToFile(job.inputR2ObjectKey, inputPath);

        const sourceMetadata = await this.probe(inputPath);
        if (!sourceMetadata.width || !sourceMetadata.height) {
          throw new Error("The uploaded file does not contain a readable video stream.");
        }

        const [threads, maxHeight, crf, preset] = await Promise.all([
          this.settings.get("mediaProcessingFfmpegThreadsPerJob"),
          this.settings.get("mediaProcessingMaxHeight"),
          this.settings.get("mediaProcessingVideoCrf"),
          this.settings.get("mediaProcessingPreset"),
        ]);
        await this.requireOwnedStage(job.id, workerId, "PROCESSING", "FFMPEG_TRANSCODING", 20);
        await runFfmpeg({
          executable: this.ffmpegPath,
          inputPath,
          outputPath,
          threads: threads as number,
          maxHeight: maxHeight as number,
          crf: crf as number,
          preset: preset as string,
        });
        canonicalMetadata = await this.probe(outputPath);
        if (!canonicalMetadata.width || !canonicalMetadata.height) {
          throw new Error("FFmpeg did not produce a readable canonical video stream.");
        }

        await this.requireOwnedStage(job.id, workerId, "UPLOADING", "UPLOADING_CANONICAL", 80);
        await this.storage.uploadFile(job.outputR2ObjectKey, outputPath, "video/mp4");
      }

      await this.requireOwnedStage(job.id, workerId, "VERIFYING", "VERIFYING_R2_OBJECT", 92);
      const verified = await this.storage.headObject(job.outputR2ObjectKey);
      if (!isVerifiedCanonical(verified)) {
        throw new Error("The canonical R2 object failed size or content-type verification.");
      }

      if (
        job.inputR2ObjectKey &&
        job.stagingKey === job.inputR2ObjectKey &&
        job.inputR2ObjectKey !== job.outputR2ObjectKey
      ) {
        await this.requireOwnedStage(job.id, workerId, "VERIFYING", "REMOVING_STAGING_SOURCE", 96);
        await this.storage.deleteObject(job.inputR2ObjectKey);
      }

      const finalized = await this.lifecycle.finalizeReady({
        jobId: job.id,
        workerId,
        metadata: {
          sizeBytes: verified.sizeBytes,
          durationMs: canonicalMetadata.durationMs,
          width: canonicalMetadata.width,
          height: canonicalMetadata.height,
        },
      });
      if (!finalized) throw new Error("The media job lease was lost before READY finalization.");
      this.logger.log(`Media processing job ${job.id} reached READY.`);
    } catch (error) {
      const message = errorMessage(error);
      this.logger.error(`Media processing job ${job.id} failed: ${message}`);
      await this.queue.requeueAfterFailure({
        jobId: job.id,
        workerId,
        errorCode: classifyProcessingError(error),
        errorMessage: message.slice(0, 4000),
      });
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async probe(filePath: string): Promise<ProbeMetadata> {
    const { stdout } = await execFileAsync(
      this.ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,width,height",
        "-of",
        "json",
        filePath,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    const durationSeconds = Number(parsed.format?.duration);
    return {
      durationMs:
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.round(durationSeconds * 1000)
          : null,
      width: video?.width && video.width > 0 ? video.width : null,
      height: video?.height && video.height > 0 ? video.height : null,
    };
  }

  private async tryHead(key: string) {
    try {
      return await this.storage.headObject(key);
    } catch {
      return null;
    }
  }

  private async requireOwnedStage(
    jobId: string,
    workerId: string,
    status: "PROCESSING" | "UPLOADING" | "VERIFYING",
    stage: string,
    progressPercent: number,
  ): Promise<void> {
    const updated = await this.lifecycle.setOwnedStage({
      jobId,
      workerId,
      status,
      stage,
      progressPercent,
    });
    if (!updated) throw new Error("The media worker no longer owns this processing lease.");
  }
}

function sourceExtension(mimeType: string): string {
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType === "video/mp4") return ".mp4";
  return ".source";
}

function isVerifiedCanonical(
  metadata: { sizeBytes: number; contentType: string | null } | null,
): metadata is { sizeBytes: number; contentType: string | null } {
  if (!metadata || metadata.sizeBytes <= 0) return false;
  const contentType = metadata.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "video/mp4" || contentType === "application/octet-stream";
}

function classifyProcessingError(error: unknown): string {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("ffmpeg") || message.includes("ffprobe")) return "FFMPEG_PROCESSING_FAILED";
  if (message.includes("r2")) return "R2_PROCESSING_FAILED";
  if (message.includes("video stream")) return "INVALID_VIDEO_SOURCE";
  return "MEDIA_PROCESSING_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runFfmpeg(input: {
  executable: string;
  inputPath: string;
  outputPath: string;
  threads: number;
  maxHeight: number;
  crf: number;
  preset: string;
}): Promise<void> {
  const scaleFilter = `scale=-2:min(${input.maxHeight}\\,ih)`;
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-i",
    input.inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-vf",
    scaleFilter,
    "-c:v",
    "libx264",
    "-preset",
    input.preset,
    "-crf",
    String(input.crf),
    "-pix_fmt",
    "yuv420p",
    "-threads",
    String(input.threads),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}. ${stderr}`.trim(),
          ),
        );
      }
    });
  });
}
