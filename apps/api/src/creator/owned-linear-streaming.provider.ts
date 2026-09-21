import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, type ReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import {
  type LinearAdMarker,
  type LinearChannelPlan,
  type LinearOutputState,
  type LinearProgram,
  LinearProviderUnavailableError,
  type LinearStreamingProvider,
} from "./creator-tv-linear.provider.js";

const RESOURCE_STATE_FILE = "resource.json";
const RAW_MANIFEST_FILE = "media.m3u8";
const PUBLIC_MANIFEST_FILE = "index.m3u8";
const DEFAULT_SEGMENT_DURATION_SECONDS = 4;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;
const HLS_LIST_SIZE = 18;
const FILLER_CHUNK_MS = 5_000;
const SHORT_WAIT_MS = 100;
const PROCESS_KILL_GRACE_MS = 5_000;

export interface OwnedLinearEnvironment {
  LINEAR_COMPUTE_ENABLED?: string | undefined;
  LINEAR_PUBLIC_BASE_URL?: string | undefined;
  LINEAR_OUTPUT_ROOT?: string | undefined;
  LINEAR_SEGMENT_DURATION_SECONDS?: string | undefined;
  LINEAR_MAX_RECOVERY_ATTEMPTS?: string | undefined;
  FFMPEG_PATH?: string | undefined;
}

export type LinearSourceMaterializer = (objectKey: string, destinationPath: string) => Promise<void>;

export interface OwnedLinearPublicOutput {
  body: Buffer | ReadStream;
  contentType: string;
  contentLength: number | null;
  cacheControl: string;
}

interface PersistedLinearResource {
  version: 1;
  resourceId: string;
  tvChannelId: string;
  desired: "RUNNING";
  plan: LinearChannelPlan;
}

interface OwnedLinearResource {
  resourceId: string;
  plan: LinearChannelPlan;
  status: LinearOutputState["status"];
  hlsUrl: string | null;
  runVersion: number;
  stopped: boolean;
  child: ChildProcess | null;
  runningOccurrenceKey: string | null;
  lastTransitionAt: string | null;
  scheduleDriftMs: number | null;
  maxScheduleDriftMs: number | null;
  recoveryCount: number;
  lastManifestAt: string | null;
  lastError: string | null;
  exhaustedOccurrenceKey: string | null;
  exhaustedUntilMs: number;
  sourcePromises: Map<string, Promise<string>>;
}

@Injectable()
export class OwnedLinearStreamingProvider
  implements LinearStreamingProvider, OnModuleInit, OnModuleDestroy
{
  readonly key = "owned-ffmpeg";

  private readonly resourcesByTv = new Map<string, OwnedLinearResource>();
  private readonly resourcesById = new Map<string, OwnedLinearResource>();
  private readonly outputRoot: string | null;
  private readonly publicBaseUrl: string | null;
  private readonly ffmpegPath: string;
  private readonly segmentDurationSeconds: number;
  private readonly maxRecoveryAttempts: number;
  private shuttingDown = false;

  constructor(
    private readonly environment: OwnedLinearEnvironment = process.env,
    private readonly materializeSource: LinearSourceMaterializer = async () => {
      throw new LinearProviderUnavailableError();
    },
  ) {
    this.outputRoot = normalizeNonEmpty(environment.LINEAR_OUTPUT_ROOT);
    this.publicBaseUrl = normalizePublicBaseUrl(environment.LINEAR_PUBLIC_BASE_URL);
    this.ffmpegPath = normalizeNonEmpty(environment.FFMPEG_PATH) ?? "ffmpeg";
    this.segmentDurationSeconds = integerSetting(
      environment.LINEAR_SEGMENT_DURATION_SECONDS,
      DEFAULT_SEGMENT_DURATION_SECONDS,
      1,
      10,
    );
    this.maxRecoveryAttempts = integerSetting(
      environment.LINEAR_MAX_RECOVERY_ATTEMPTS,
      DEFAULT_MAX_RECOVERY_ATTEMPTS,
      0,
      10,
    );
  }

  get configured(): boolean {
    return (
      this.environment.LINEAR_COMPUTE_ENABLED === "1" &&
      this.outputRoot !== null &&
      this.publicBaseUrl !== null
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.configured || !this.outputRoot) return;
    await mkdir(this.outputRoot, { recursive: true });
    const entries = await readdir(this.outputRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const persisted = await this.readPersistedResource(entry.name);
      if (!persisted || persisted.desired !== "RUNNING") continue;
      if (this.resourcesByTv.has(persisted.tvChannelId)) continue;

      const resource = this.createResource(persisted.resourceId, persisted.plan);
      resource.recoveryCount = 1;
      resource.lastError = "Recovered owned linear compute after provider process restart.";
      this.registerResource(resource);
      void this.startRunner(resource);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    const terminations: Promise<void>[] = [];
    for (const resource of this.resourcesById.values()) {
      resource.runVersion += 1;
      terminations.push(this.terminateChild(resource));
    }
    await Promise.allSettled(terminations);
  }

  async getState(tvChannelId: string): Promise<LinearOutputState> {
    if (!this.configured) return this.unconfiguredState();
    const resource = this.resourcesByTv.get(tvChannelId);
    if (!resource) {
      return {
        providerKey: this.key,
        configured: true,
        status: "STOPPED",
        hlsUrl: null,
        providerResourceId: null,
        lastPlanGeneratedAt: null,
        message: "No owned linear compute resource is running for this Creator TV channel.",
        monitoring: emptyMonitoring(),
      };
    }
    return this.snapshot(resource);
  }

  async provision(plan: LinearChannelPlan): Promise<LinearOutputState> {
    this.assertConfigured();
    validatePlan(plan);

    const existing = this.resourcesByTv.get(plan.tvChannelId);
    if (existing && !existing.stopped) {
      return this.reconcile(plan);
    }

    const resource = this.createResource(randomUUID(), plan);
    this.registerResource(resource);
    await this.prepareFreshResource(resource);
    await this.persistResource(resource);
    void this.startRunner(resource);
    return this.snapshot(resource);
  }

  async reconcile(plan: LinearChannelPlan): Promise<LinearOutputState> {
    this.assertConfigured();
    validatePlan(plan);

    const resource = this.resourcesByTv.get(plan.tvChannelId);
    if (!resource || resource.stopped) return this.provision(plan);

    const now = Date.now();
    const previousCurrent = currentProgram(resource.plan, now);
    const nextCurrent = currentProgram(plan, now);
    const restartRequired =
      resource.status === "ERROR" || !sameProgramForContinuousPlayout(previousCurrent, nextCurrent);

    resource.plan = plan;
    resource.lastError = restartRequired ? resource.lastError : null;
    await this.persistResource(resource);
    void this.prewarmNext(resource).catch(() => undefined);

    if (restartRequired) {
      resource.status = "PROVISIONING";
      resource.hlsUrl = null;
      resource.stopped = false;
      resource.runVersion += 1;
      const version = resource.runVersion;
      await this.terminateChild(resource);
      void this.runResource(resource, version);
    }

    return this.snapshot(resource);
  }

  async stop(tvChannelId: string): Promise<LinearOutputState> {
    if (!this.configured) return this.unconfiguredState("STOPPED");
    const resource = this.resourcesByTv.get(tvChannelId);
    if (!resource) {
      return {
        providerKey: this.key,
        configured: true,
        status: "STOPPED",
        hlsUrl: null,
        providerResourceId: null,
        lastPlanGeneratedAt: null,
        message: "Owned linear compute was already stopped.",
        monitoring: emptyMonitoring(),
      };
    }

    resource.stopped = true;
    resource.status = "STOPPED";
    resource.hlsUrl = null;
    resource.runningOccurrenceKey = null;
    resource.runVersion += 1;
    await this.terminateChild(resource);
    await rm(this.resourceDirectory(resource.resourceId), { recursive: true, force: true });
    return this.snapshot(resource, "Owned linear compute stopped. Progressive MP4 fallback remains available.");
  }

  async readPublicOutput(
    providerResourceId: string,
    fileName: string,
  ): Promise<OwnedLinearPublicOutput | null> {
    if (!this.configured) return null;
    const resource = this.resourcesById.get(providerResourceId);
    if (!resource || resource.stopped || resource.status !== "READY") return null;

    if (fileName === PUBLIC_MANIFEST_FILE) {
      const raw = await readFile(this.rawManifestPath(resource.resourceId), "utf8").catch(() => null);
      if (!raw || !isPlayableManifest(raw)) return null;
      const rendered = injectAdMarkersIntoManifest(
        raw,
        resource.plan,
        this.segmentDurationSeconds * 1_000,
      );
      const body = Buffer.from(rendered, "utf8");
      return {
        body,
        contentType: "application/vnd.apple.mpegurl",
        contentLength: body.length,
        cacheControl: "no-store, max-age=0",
      };
    }

    if (!/^segment-\d+\.ts$/.test(fileName)) return null;
    const filePath = join(this.resourceDirectory(providerResourceId), fileName);
    const metadata = await stat(filePath).catch(() => null);
    if (!metadata?.isFile() || metadata.size <= 0) return null;
    return {
      body: createReadStream(filePath),
      contentType: "video/mp2t",
      contentLength: metadata.size,
      cacheControl: "public, max-age=30, immutable",
    };
  }

  private async startRunner(resource: OwnedLinearResource): Promise<void> {
    resource.runVersion += 1;
    await this.runResource(resource, resource.runVersion);
  }

  private async runResource(resource: OwnedLinearResource, version: number): Promise<void> {
    try {
      while (this.isCurrent(resource, version)) {
        const now = Date.now();
        const active = currentProgram(resource.plan, now);

        if (active) {
          if (
            resource.exhaustedOccurrenceKey === active.occurrenceKey &&
            now < resource.exhaustedUntilMs
          ) {
            await this.runFiller(
              resource,
              version,
              Math.min(FILLER_CHUNK_MS, resource.exhaustedUntilMs - now),
            );
            continue;
          }
          resource.exhaustedOccurrenceKey = null;
          resource.exhaustedUntilMs = 0;
          await this.runProgramWithRecovery(resource, version, active);
          continue;
        }

        const next = nextProgram(resource.plan, now);
        if (next) {
          void this.ensureSource(resource, next).catch(() => undefined);
          const gapMs = Date.parse(next.startsAt) - now;
          if (gapMs <= SHORT_WAIT_MS) {
            await sleep(Math.max(10, gapMs));
          } else {
            await this.runFiller(resource, version, Math.min(FILLER_CHUNK_MS, gapMs));
          }
          continue;
        }

        await this.runFiller(resource, version, FILLER_CHUNK_MS);
      }
    } catch (error) {
      if (!this.isCurrent(resource, version)) return;
      resource.status = "ERROR";
      resource.hlsUrl = null;
      resource.runningOccurrenceKey = null;
      resource.lastError = errorMessage(error);
    }
  }

  private async runProgramWithRecovery(
    resource: OwnedLinearResource,
    version: number,
    program: LinearProgram,
  ): Promise<void> {
    let attempt = 0;
    while (this.isCurrent(resource, version)) {
      try {
        const sourcePath = await this.ensureSource(resource, program);
        const now = Date.now();
        const endsAtMs = Date.parse(program.endsAt);
        if (endsAtMs <= now) return;

        const seekMs = sourceSeekOffsetMs(resource.plan, program, now);
        this.markTransition(resource, program, now);
        void this.prewarmNext(resource).catch(() => undefined);

        const durationMs = Math.max(250, endsAtMs - now);
        await this.runFfmpeg(
          resource,
          version,
          buildProgramFfmpegArgs({
            ffmpegInputPath: sourcePath,
            seekMs,
            durationMs,
            segmentDurationSeconds: this.segmentDurationSeconds,
            outputDirectory: this.resourceDirectory(resource.resourceId),
          }),
        );

        const remainingMs = endsAtMs - Date.now();
        if (remainingMs > 500) {
          resource.exhaustedOccurrenceKey = program.occurrenceKey;
          resource.exhaustedUntilMs = endsAtMs;
        }
        resource.lastError = null;
        return;
      } catch (error) {
        if (!this.isCurrent(resource, version)) return;
        resource.recoveryCount += 1;
        resource.lastError = errorMessage(error);
        if (attempt >= this.maxRecoveryAttempts) throw error;
        const delayMs = Math.min(5_000, 500 * 2 ** attempt);
        attempt += 1;
        await sleep(delayMs);
      }
    }
  }

  private async runFiller(
    resource: OwnedLinearResource,
    version: number,
    requestedDurationMs: number,
  ): Promise<void> {
    let attempt = 0;
    while (this.isCurrent(resource, version)) {
      const durationMs = Math.max(250, Math.min(FILLER_CHUNK_MS, requestedDurationMs));
      resource.runningOccurrenceKey = null;
      try {
        await this.runFfmpeg(
          resource,
          version,
          buildFillerFfmpegArgs({
            durationMs,
            segmentDurationSeconds: this.segmentDurationSeconds,
            outputDirectory: this.resourceDirectory(resource.resourceId),
          }),
        );
        return;
      } catch (error) {
        if (!this.isCurrent(resource, version)) return;
        resource.recoveryCount += 1;
        resource.lastError = errorMessage(error);
        if (attempt >= this.maxRecoveryAttempts) throw error;
        const delayMs = Math.min(5_000, 500 * 2 ** attempt);
        attempt += 1;
        await sleep(delayMs);
      }
    }
  }

  private async runFfmpeg(
    resource: OwnedLinearResource,
    version: number,
    args: readonly string[],
  ): Promise<void> {
    const previousManifestMtimeMs = await stat(this.rawManifestPath(resource.resourceId))
      .then((metadata) => metadata.mtimeMs)
      .catch(() => 0);
    await new Promise<void>((resolve, reject) => {
      if (!this.isCurrent(resource, version)) {
        resolve();
        return;
      }

      const child = spawn(this.ffmpegPath, [...args], {
        stdio: ["ignore", "ignore", "pipe"],
        shell: false,
      });
      resource.child = child;
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (resource.child === child) resource.child = null;
        if (!this.isCurrent(resource, version)) {
          resolve();
          return;
        }
        if (error) reject(error);
        else resolve();
      };

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr = boundedAppend(stderr, String(chunk), 12_000);
      });
      child.once("error", (error) => {
        finish(new Error("Owned linear FFmpeg failed to start: " + error.message));
      });
      child.once("close", (code, signal) => {
        if (code === 0 || !this.isCurrent(resource, version)) {
          finish();
          return;
        }
        const suffix = stderr.trim() ? " " + stderr.trim() : "";
        finish(
          new Error(
            "Owned linear FFmpeg exited with code " +
              String(code) +
              " (signal " +
              String(signal ?? "none") +
              ")." +
              suffix,
          ),
        );
      });

      void this.observeManifest(resource, version, previousManifestMtimeMs);
    });
  }

  private async observeManifest(
    resource: OwnedLinearResource,
    version: number,
    previousManifestMtimeMs: number,
  ): Promise<void> {
    while (this.isCurrent(resource, version)) {
      const manifestPath = this.rawManifestPath(resource.resourceId);
      const [manifest, metadata] = await Promise.all([
        readFile(manifestPath, "utf8").catch(() => null),
        stat(manifestPath).catch(() => null),
      ]);
      if (
        manifest &&
        metadata?.isFile() &&
        metadata.mtimeMs > previousManifestMtimeMs &&
        isPlayableManifest(manifest)
      ) {
        const now = new Date().toISOString();
        resource.lastManifestAt = now;
        if (resource.status !== "READY" || !resource.hlsUrl) {
          resource.status = "READY";
          resource.hlsUrl = this.publicManifestUrl(resource.resourceId);
          resource.lastError = null;
        }
        return;
      }
      if (!resource.child) return;
      await sleep(100);
    }
  }

  private markTransition(resource: OwnedLinearResource, program: LinearProgram, now: number): void {
    if (resource.runningOccurrenceKey === program.occurrenceKey) return;
    const generatedAtMs = Date.parse(resource.plan.generatedAt);
    const startsAtMs = Date.parse(program.startsAt);
    const driftMs = startsAtMs <= generatedAtMs ? 0 : now - startsAtMs;
    resource.runningOccurrenceKey = program.occurrenceKey;
    resource.lastTransitionAt = new Date(now).toISOString();
    resource.scheduleDriftMs = driftMs;
    resource.maxScheduleDriftMs = Math.max(
      resource.maxScheduleDriftMs ?? 0,
      Math.abs(driftMs),
    );
  }

  private async prewarmNext(resource: OwnedLinearResource): Promise<void> {
    const upcoming = nextProgram(resource.plan, Date.now());
    if (!upcoming) return;
    await this.ensureSource(resource, upcoming);
  }

  private async ensureSource(
    resource: OwnedLinearResource,
    program: LinearProgram,
  ): Promise<string> {
    const existing = resource.sourcePromises.get(program.source.objectKey);
    if (existing) return existing;

    const promise = this.materializeSourceFile(resource, program);
    resource.sourcePromises.set(program.source.objectKey, promise);
    try {
      return await promise;
    } catch (error) {
      resource.sourcePromises.delete(program.source.objectKey);
      throw error;
    }
  }

  private async materializeSourceFile(
    resource: OwnedLinearResource,
    program: LinearProgram,
  ): Promise<string> {
    if (program.source.mimeType !== "video/mp4") {
      throw new Error("Owned linear compute currently accepts validated video/mp4 schedule sources.");
    }

    const hash = createHash("sha256").update(program.source.objectKey).digest("hex");
    const sourceDirectory = join(this.resourceDirectory(resource.resourceId), "sources");
    const destinationPath = join(sourceDirectory, hash + ".mp4");
    const existing = await stat(destinationPath).catch(() => null);
    if (existing?.isFile() && existing.size > 0) return destinationPath;

    await mkdir(sourceDirectory, { recursive: true });
    const temporaryPath = destinationPath + "." + randomUUID() + ".part";
    try {
      await this.materializeSource(program.source.objectKey, temporaryPath);
      const metadata = await stat(temporaryPath);
      if (!metadata.isFile() || metadata.size <= 0) {
        throw new Error("Owned linear source materialization produced an empty file.");
      }
      await rename(temporaryPath, destinationPath);
      return destinationPath;
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async prepareFreshResource(resource: OwnedLinearResource): Promise<void> {
    const directory = this.resourceDirectory(resource.resourceId);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
  }

  private async persistResource(resource: OwnedLinearResource): Promise<void> {
    if (!this.outputRoot || resource.stopped) return;
    const directory = this.resourceDirectory(resource.resourceId);
    await mkdir(directory, { recursive: true });
    const payload: PersistedLinearResource = {
      version: 1,
      resourceId: resource.resourceId,
      tvChannelId: resource.plan.tvChannelId,
      desired: "RUNNING",
      plan: resource.plan,
    };
    const target = join(directory, RESOURCE_STATE_FILE);
    const temporary = target + ".tmp";
    await writeFile(temporary, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  private async readPersistedResource(directoryName: string): Promise<PersistedLinearResource | null> {
    if (!this.outputRoot || !isUuid(directoryName)) return null;
    const raw = await readFile(join(this.outputRoot, directoryName, RESOURCE_STATE_FILE), "utf8").catch(
      () => null,
    );
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isPersistedLinearResource(parsed)) return null;
      validatePlan(parsed.plan);
      if (parsed.resourceId !== directoryName) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private createResource(resourceId: string, plan: LinearChannelPlan): OwnedLinearResource {
    return {
      resourceId,
      plan,
      status: "PROVISIONING",
      hlsUrl: null,
      runVersion: 0,
      stopped: false,
      child: null,
      runningOccurrenceKey: null,
      lastTransitionAt: null,
      scheduleDriftMs: null,
      maxScheduleDriftMs: null,
      recoveryCount: 0,
      lastManifestAt: null,
      lastError: null,
      exhaustedOccurrenceKey: null,
      exhaustedUntilMs: 0,
      sourcePromises: new Map(),
    };
  }

  private registerResource(resource: OwnedLinearResource): void {
    const previous = this.resourcesByTv.get(resource.plan.tvChannelId);
    if (previous && previous.resourceId !== resource.resourceId) {
      previous.stopped = true;
      previous.runVersion += 1;
      this.resourcesById.delete(previous.resourceId);
      void this.terminateChild(previous);
    }
    this.resourcesByTv.set(resource.plan.tvChannelId, resource);
    this.resourcesById.set(resource.resourceId, resource);
  }

  private async terminateChild(resource: OwnedLinearResource): Promise<void> {
    const child = resource.child;
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };
      child.once("close", finish);
      child.kill("SIGTERM");
      const forceTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        finish();
      }, PROCESS_KILL_GRACE_MS);
      forceTimer.unref();
    });
    if (resource.child === child) resource.child = null;
  }

  private isCurrent(resource: OwnedLinearResource, version: number): boolean {
    return !this.shuttingDown && !resource.stopped && resource.runVersion === version;
  }

  private snapshot(resource: OwnedLinearResource, message?: string): LinearOutputState {
    return {
      providerKey: this.key,
      configured: true,
      status: resource.status,
      hlsUrl: resource.status === "READY" ? resource.hlsUrl : null,
      providerResourceId: resource.resourceId,
      lastPlanGeneratedAt: resource.plan.generatedAt,
      message:
        message ??
        resource.lastError ??
        (resource.status === "READY"
          ? "Owned FFmpeg linear compute is packaging a continuously refreshed HLS channel."
          : "Owned FFmpeg linear compute is preparing the channel; progressive MP4 remains the fallback."),
      monitoring: {
        runningOccurrenceKey: resource.runningOccurrenceKey,
        lastTransitionAt: resource.lastTransitionAt,
        scheduleDriftMs: resource.scheduleDriftMs,
        maxScheduleDriftMs: resource.maxScheduleDriftMs,
        recoveryCount: resource.recoveryCount,
        lastManifestAt: resource.lastManifestAt,
        lastError: resource.lastError,
      },
    };
  }

  private unconfiguredState(
    status: LinearOutputState["status"] = "UNCONFIGURED",
  ): LinearOutputState {
    return {
      providerKey: this.key,
      configured: false,
      status,
      hlsUrl: null,
      providerResourceId: null,
      lastPlanGeneratedAt: null,
      message:
        "Owned linear compute is disabled or missing its public base URL/output root. Progressive MP4 remains the safe Creator TV fallback.",
      monitoring: emptyMonitoring(),
    };
  }

  private publicManifestUrl(resourceId: string): string {
    if (!this.publicBaseUrl) throw new LinearProviderUnavailableError();
    return (
      this.publicBaseUrl +
      "/" +
      encodeURIComponent(resourceId) +
      "/" +
      PUBLIC_MANIFEST_FILE
    );
  }

  private resourceDirectory(resourceId: string): string {
    if (!this.outputRoot) throw new LinearProviderUnavailableError();
    return join(this.outputRoot, resourceId);
  }

  private rawManifestPath(resourceId: string): string {
    return join(this.resourceDirectory(resourceId), RAW_MANIFEST_FILE);
  }

  private assertConfigured(): void {
    if (!this.configured) throw new LinearProviderUnavailableError();
  }
}

export function buildProgramFfmpegArgs(input: {
  ffmpegInputPath: string;
  seekMs: number;
  durationMs: number;
  segmentDurationSeconds: number;
  outputDirectory: string;
}): readonly string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-re",
    "-ss",
    seconds(input.seekMs),
    "-i",
    input.ffmpegInputPath,
    "-t",
    seconds(input.durationMs),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-force_key_frames",
    "expr:gte(t,n_forced*" + String(input.segmentDurationSeconds) + ")",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-max_muxing_queue_size",
    "1024",
    ...hlsOutputArgs(input),
  ];
}

export function buildFillerFfmpegArgs(input: {
  durationMs: number;
  segmentDurationSeconds: number;
  outputDirectory: string;
}): readonly string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1280x720:r=30",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t",
    seconds(input.durationMs),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-force_key_frames",
    "expr:gte(t,n_forced*" + String(input.segmentDurationSeconds) + ")",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-ar",
    "48000",
    ...hlsOutputArgs(input),
  ];
}

function hlsOutputArgs(input: {
  segmentDurationSeconds: number;
  outputDirectory: string;
}): readonly string[] {
  return [
    "-f",
    "hls",
    "-hls_time",
    String(input.segmentDurationSeconds),
    "-hls_list_size",
    String(HLS_LIST_SIZE),
    "-hls_delete_threshold",
    "6",
    "-hls_start_number_source",
    "epoch_us",
    "-hls_flags",
    "delete_segments+append_list+program_date_time+independent_segments+discont_start+omit_endlist+temp_file",
    "-hls_allow_cache",
    "0",
    "-hls_segment_filename",
    join(input.outputDirectory, "segment-%d.ts"),
    join(input.outputDirectory, RAW_MANIFEST_FILE),
  ];
}

export function injectAdMarkersIntoManifest(
  manifest: string,
  plan: LinearChannelPlan,
  segmentDurationMs: number,
): string {
  const programDates = manifest
    .split("\n")
    .filter((line) => line.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))
    .map((line) => Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length)))
    .filter((value) => Number.isFinite(value));
  if (!programDates.length) return manifest;

  const windowStart = Math.min(...programDates) - segmentDurationMs;
  const windowEnd = Math.max(...programDates) + segmentDurationMs * 2;
  const programByOccurrence = new Map(
    plan.programs.map((program) => [program.occurrenceKey, program]),
  );
  const markerLines = plan.adMarkers.flatMap((marker) => {
    const program = programByOccurrence.get(marker.occurrenceKey);
    if (!program) return [];
    const markerAt = Date.parse(program.startsAt) + marker.offsetMs;
    if (!Number.isFinite(markerAt) || markerAt < windowStart || markerAt > windowEnd) return [];
    return [renderAdMarker(marker, markerAt)];
  });
  if (!markerLines.length) return manifest;

  const lines = manifest.trimEnd().split("\n");
  const insertionIndex = lines.findIndex(
    (line) => line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") || line.startsWith("#EXTINF:"),
  );
  lines.splice(insertionIndex < 0 ? lines.length : insertionIndex, 0, ...markerLines);
  return lines.join("\n") + "\n";
}

function renderAdMarker(marker: LinearAdMarker, markerAt: number): string {
  return (
    "#EXT-X-DATERANGE:ID=\"" +
    hlsQuoted(marker.id) +
    "\",CLASS=\"com.ayin.ad-break\",START-DATE=\"" +
    new Date(markerAt).toISOString() +
    "\",X-AYIN-SCTE35-INTENT=\"YES\",X-AYIN-SOURCE=\"" +
    hlsQuoted(marker.source) +
    "\",X-AYIN-OCCURRENCE=\"" +
    hlsQuoted(marker.occurrenceKey) +
    "\""
  );
}

function hlsQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function sourceSeekOffsetMs(plan: LinearChannelPlan, program: LinearProgram, now: number): number {
  const generatedAt = Date.parse(plan.generatedAt);
  const startsAt = Date.parse(program.startsAt);
  const anchor = Math.max(generatedAt, startsAt);
  return Math.max(0, program.playbackOffsetMs + Math.max(0, now - anchor));
}

function currentProgram(plan: LinearChannelPlan, now: number): LinearProgram | null {
  return (
    plan.programs.find(
      (program) => Date.parse(program.startsAt) <= now && now < Date.parse(program.endsAt),
    ) ?? null
  );
}

function nextProgram(plan: LinearChannelPlan, now: number): LinearProgram | null {
  return (
    plan.programs.find((program) => Date.parse(program.startsAt) > now) ?? null
  );
}

function sameProgramForContinuousPlayout(
  left: LinearProgram | null,
  right: LinearProgram | null,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.occurrenceKey === right.occurrenceKey &&
    left.startsAt === right.startsAt &&
    left.endsAt === right.endsAt &&
    left.source.objectKey === right.source.objectKey &&
    left.source.mimeType === right.source.mimeType
  );
}

function validatePlan(plan: LinearChannelPlan): void {
  if (!plan.tvChannelId || !plan.channelId || !plan.channelHandle) {
    throw new Error("Linear channel plan is missing its channel identity.");
  }
  if (!Number.isFinite(Date.parse(plan.generatedAt)) || !Number.isFinite(Date.parse(plan.windowEndsAt))) {
    throw new Error("Linear channel plan has an invalid generation window.");
  }

  let previousEnd = 0;
  for (const program of plan.programs) {
    const startsAt = Date.parse(program.startsAt);
    const endsAt = Date.parse(program.endsAt);
    if (
      !program.occurrenceKey ||
      !program.videoId ||
      !program.source.objectKey ||
      program.source.mimeType !== "video/mp4" ||
      !Number.isFinite(startsAt) ||
      !Number.isFinite(endsAt) ||
      endsAt <= startsAt ||
      !Number.isFinite(program.playbackOffsetMs) ||
      program.playbackOffsetMs < 0
    ) {
      throw new Error("Linear channel plan contains an invalid scheduled program.");
    }
    if (previousEnd > startsAt) {
      throw new Error("Linear channel plan contains overlapping scheduled programs.");
    }
    previousEnd = endsAt;
  }
}

function isPlayableManifest(manifest: string): boolean {
  return (
    manifest.startsWith("#EXTM3U") &&
    manifest.includes("#EXT-X-PROGRAM-DATE-TIME:") &&
    /(?:^|\n)segment-\d+\.ts(?:\r?\n|$)/.test(manifest)
  );
}

function normalizeNonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizePublicBaseUrl(value: string | undefined): string | null {
  const normalized = normalizeNonEmpty(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash) return null;
    return normalized.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function integerSetting(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return fallback;
  }
  return value;
}

function seconds(milliseconds: number): string {
  return (Math.max(0, milliseconds) / 1_000).toFixed(3);
}

function boundedAppend(current: string, addition: string, maxLength: number): string {
  const next = current + addition;
  return next.length <= maxLength ? next : next.slice(next.length - maxLength);
}

function emptyMonitoring() {
  return {
    runningOccurrenceKey: null,
    lastTransitionAt: null,
    scheduleDriftMs: null,
    maxScheduleDriftMs: null,
    recoveryCount: 0,
    lastManifestAt: null,
    lastError: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isPersistedLinearResource(value: unknown): value is PersistedLinearResource {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedLinearResource>;
  return (
    candidate.version === 1 &&
    typeof candidate.resourceId === "string" &&
    isUuid(candidate.resourceId) &&
    typeof candidate.tvChannelId === "string" &&
    candidate.desired === "RUNNING" &&
    Boolean(candidate.plan) &&
    typeof candidate.plan === "object"
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, milliseconds));
    timer.unref();
  });
}
