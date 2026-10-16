import "reflect-metadata";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireTestDatabase } from "../../../scripts/test-database-guard.mjs";
import { AppModule } from "../src/app.module.js";
import type { PublicIdentity } from "../src/auth/auth.service.js";
import { MediaProcessingExecutorService } from "../src/media/media-processing-executor.service.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
import { MEDIA_STORAGE_CONFIG } from "../src/media/media-storage.adapter.js";
import type { MediaStorageConfig } from "../src/media/media-storage.config.js";
import { ConnectedMediaObjectStore } from "./helpers/connected-media-object-store.js";

// This explicit, separately reported acceptance suite requires real PostgreSQL
// and pinned FFmpeg. It must not silently use app DATABASE_URL, mock READY, or
// call a provider outside this process's newly allocated loopback endpoint.
const enabled = process.env.AYIN_CONNECTED_MEDIA_ACCEPTANCE === "1";
const acceptanceDescribe = enabled ? describe : describe.skip;
const runProcess = promisify(execFile);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const processOptions = {
  timeout: 30_000,
  maxBuffer: 2 * 1024 * 1024,
  killSignal: "SIGKILL" as const,
};

interface SessionResponse {
  video: { id: string; slug: string };
  uploadSession: {
    mode: string;
    assetId: string;
    objectKey: string;
    sessionToken: string;
    upload: { url: string; headers: Record<string, string> };
  };
}

acceptanceDescribe(
  "connected media: real auth, HTTP store, PostgreSQL, FFmpeg, publish and playback",
  () => {
    const runId = randomUUID();
    const store = new ConnectedMediaObjectStore();
    const evidence: Array<Record<string, unknown>> = [];
    let app: NestFastifyApplication | undefined;
    let prisma: ReturnType<typeof createPrismaClient> | undefined;
    let apiOrigin = "";
    let workRoot = "";
    let processorRoot = "";
    let storageStarted = false;
    let ffmpeg = "";
    let ffprobe = "";
    let ffmpegVersion = "";
    let databaseIdentity: Record<string, unknown> | undefined;
    const accounts: string[] = [];
    const channels: string[] = [];
    const previousEnvironment = new Map<string, string | undefined>();

    function setEnvironment(name: string, value: string) {
      previousEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    }

    beforeAll(async () => {
      const databaseUrl = requireTestDatabase();
      ffmpeg = process.env.FFMPEG_PATH ?? "";
      ffprobe = process.env.FFPROBE_PATH ?? "";
      if (!ffmpeg || !ffprobe)
        throw new Error(
          "Connected acceptance requires explicit pinned FFMPEG_PATH and FFPROBE_PATH.",
        );
      for (const executable of [ffmpeg, ffprobe]) {
        const result = await runProcess(executable, ["-version"], processOptions);
        const firstLine = result.stdout.split("\n")[0] ?? "";
        expect(firstLine).toMatch(/^(?:ffmpeg|ffprobe) version 6\.0\.1(?:\s|-)/);
        if (executable === ffmpeg) ffmpegVersion = firstLine;
      }
      prisma = createPrismaClient(databaseUrl);
      const identities = await prisma.$queryRaw<
        Array<{ database: string; role: string; host: string | null }>
      >`
      SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS host
    `;
      const identity = identities[0];
      expect(identity?.database).toMatch(/^ayin_(?:test|e2e)(?:_[a-z0-9_]+)?$/);
      expect(["ayin", "ayin_test", "ayin_e2e"]).toContain(identity?.role);
      // Docker port forwarding still has a loopback client endpoint, while the
      // server reports its own bridge address. Record that address; the guard
      // above enforces the actual connection coordinates before opening a client.
      expect(identity?.host).toBeTruthy();
      databaseIdentity = identity;
      // Claiming another suite's queue would invalidate this proof. Run this file
      // alone on its disposable service database, never in parallel with writers.
      expect(
        await prisma.mediaProcessingJob.count({
          where: { status: { notIn: ["READY", "FAILED"] } },
        }),
      ).toBe(0);
      workRoot = await mkdtemp(join(tmpdir(), "ayin-connected-media-"));
      processorRoot = join(workRoot, "worker");
      const fixtureConfig = await store.start();
      storageStarted = true;
      setEnvironment("DATABASE_URL", databaseUrl);
      setEnvironment("AUTH_TOKEN_SECRET", `connected-auth-${runId}-only-for-this-test`);
      setEnvironment("UPLOAD_SESSION_SECRET", `connected-upload-${runId}-only-for-this-test`);
      setEnvironment("WEB_ORIGIN", "http://localhost:3000");
      setEnvironment("MEDIA_PROCESSING_WORKDIR", processorRoot);
      const config: MediaStorageConfig = {
        ...fixtureConfig,
        mode: "r2",
        appEnv: "test",
        accountId: "loopback-fixture",
        region: "auto",
        uploadUrlTtlSeconds: 900,
        partSizeBytes: 5 * 1024 * 1024,
        multipartThresholdBytes: 5 * 1024 * 1024,
        uploadSessionSecret: process.env.UPLOAD_SESSION_SECRET!,
        recoveryV2Enabled: false,
      };
      const moduleReference = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MEDIA_STORAGE_CONFIG)
        .useValue(config)
        .compile();
      app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
        logger: false,
      });
      await app.listen(0, "127.0.0.1");
      apiOrigin = await app.getUrl();
      expect(new URL(apiOrigin).hostname).toBe("127.0.0.1");
      expect(apiOrigin).not.toBe(fixtureConfig.endpoint);
    }, 30_000);

    afterAll(async () => {
      let databaseCleanupCompleted = false;
      const cleanupErrors: unknown[] = [];
      try {
        await app?.close();
        // Scope every row cleanup to accounts/channels created by this run. No seed,
        // migrate reset, global TRUNCATE, or cleanup outside the fixture is used.
        if (prisma) {
          if (channels.length) {
            await prisma.tvScheduleItem.deleteMany({
              where: { tvChannel: { channelId: { in: channels } } },
            });
            await prisma.video.deleteMany({ where: { channelId: { in: channels } } });
            await prisma.creatorContract.deleteMany({ where: { channelId: { in: channels } } });
            await prisma.channel.deleteMany({ where: { id: { in: channels } } });
          }
          if (accounts.length) await prisma.account.deleteMany({ where: { id: { in: accounts } } });
        }
        databaseCleanupCompleted = true;
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        const closed = await Promise.allSettled([
          prisma?.$disconnect(),
          storageStarted ? store.close() : Promise.resolve(),
          workRoot ? rm(workRoot, { recursive: true, force: true }) : Promise.resolve(),
        ]);
        for (const [name, value] of previousEnvironment) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
        if (process.env.AYIN_CONNECTED_MEDIA_EVIDENCE_PATH) {
          await writeFile(
            process.env.AYIN_CONNECTED_MEDIA_EVIDENCE_PATH,
            `${JSON.stringify(
              {
                kind: "API-connected acceptance; synthetic independent HTTP storage; real PostgreSQL and FFmpeg",
                runId,
                sha: process.env.GITHUB_SHA ?? null,
                run: process.env.GITHUB_RUN_ID ?? null,
                ffmpegVersion,
                databaseIdentity,
                expectedCases: 3,
                completedCases: evidence.length,
                cases: evidence,
                databaseCleanupCompleted,
                resourceCleanupCompleted: closed.every((result) => result.status === "fulfilled"),
                inputFixtures: "Synthetic two-second FFmpeg MP4/MOV with audio; not phone captures",
                browser: "NOT_RUN",
                realR2: "NOT_RUN",
                physicalDevices: "NOT_RUN",
              },
              null,
              2,
            )}\n`,
            { mode: 0o600 },
          );
        }
        cleanupErrors.push(
          ...closed.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
        );
      }
      if (cleanupErrors.length)
        throw new AggregateError(cleanupErrors, "Connected acceptance resource cleanup failed.");
    });

    async function request(
      method: "GET" | "POST",
      path: string,
      cookie?: string,
      payload?: unknown,
    ) {
      return fetch(`${apiOrigin}${path}`, {
        method,
        headers: {
          origin: "http://localhost:3000",
          ...(cookie ? { cookie } : {}),
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
    }

    async function registerAndLogin(label: string) {
      const email = `${runId}-${label}@connected.invalid`;
      const password = `owned-test-${runId}`;
      const registered = await request("POST", "/auth/register", undefined, {
        name: "Connected acceptance",
        email,
        password,
      });
      expect(registered.status).toBe(201);
      const registration = (await registered.json()) as {
        user: PublicIdentity;
      };
      const accountId = registration.user.account.id;
      const channelId = registration.user.channel.id;
      accounts.push(accountId);
      channels.push(channelId);
      store.allowedChannels.add(channelId);
      expect(
        await prisma!.channelMember.count({ where: { accountId, channelId, role: "OWNER" } }),
      ).toBe(1);
      expect(await prisma!.viewerProfile.count({ where: { accountId } })).toBe(1);
      expect(await prisma!.playlist.count({ where: { channelId, systemKey: "UPLOADS" } })).toBe(1);
      expect(await prisma!.creatorTvChannel.count({ where: { channelId } })).toBe(1);
      const registrationCookie = registered.headers.get("set-cookie")?.split(";", 1)[0];
      expect(registrationCookie).toBeTruthy();
      expect((await request("POST", "/auth/logout", registrationCookie)).status).toBe(204);
      const loggedIn = await request("POST", "/auth/login", undefined, { email, password });
      expect(loggedIn.status).toBe(200);
      const cookie = loggedIn.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toBeTruthy();
      return { cookie: cookie!, channelId };
    }

    async function upload(label: string, bytes: Buffer, mimeType: string) {
      const owner = await registerAndLogin(label);
      const response = await request("POST", "/creator/videos/drafts", owner.cookie, {
        channelId: owner.channelId,
        title: `Connected ${label}`,
        sizeBytes: bytes.length,
        mimeType,
      });
      expect(response.status).toBe(201);
      const draft = (await response.json()) as SessionResponse;
      expect(draft.uploadSession.mode).toBe("single");
      const publishPath = `/creator/videos/${draft.video.id}/publish`;
      expect(
        (await request("POST", publishPath, owner.cookie, { rightsConfirmed: true })).status,
      ).toBe(409);
      expect((await request("GET", `/public/videos/${draft.video.slug}/playback`)).status).toBe(
        404,
      );
      const signed = new URL(draft.uploadSession.upload.url);
      expect(signed.hostname).toBe("127.0.0.1");
      expect(signed.origin).not.toBe(apiOrigin);
      // A tampered signed URL must fail at the independent provider before any
      // bytes are stored; the fixture is not an unconditional successful mock.
      const changed = new URL(signed);
      changed.searchParams.set("X-Amz-Signature", "0".repeat(64));
      expect(
        (
          await fetch(changed, {
            method: "PUT",
            headers: draft.uploadSession.upload.headers,
            body: new Uint8Array(bytes),
            signal: AbortSignal.timeout(10_000),
          })
        ).status,
      ).toBe(403);
      expect(store.objects.has(draft.uploadSession.objectKey)).toBe(false);
      const put = await fetch(signed, {
        method: "PUT",
        headers: draft.uploadSession.upload.headers,
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(10_000),
      });
      expect(put.status).toBe(200);
      expect(sha256(store.objects.get(draft.uploadSession.objectKey)!.bytes)).toBe(sha256(bytes));
      // Duplicate Complete before the worker runs is the lost-response case.
      for (let attempt = 0; attempt < 2; attempt++) {
        const completed = await request("POST", "/media/uploads/sessions/complete", owner.cookie, {
          sessionToken: draft.uploadSession.sessionToken,
          parts: [],
        });
        expect(completed.status).toBe(201);
      }
      expect(await prisma!.mediaProcessingJob.count({ where: { videoId: draft.video.id } })).toBe(
        1,
      );
      expect(
        (await request("POST", publishPath, owner.cookie, { rightsConfirmed: true })).status,
      ).toBe(409);
      const processing = await request(
        "GET",
        `/creator/videos/${draft.video.id}/processing`,
        owner.cookie,
      );
      expect(await processing.json()).toMatchObject({
        ready: false,
        videoStatus: "VALIDATING",
        processing: { status: "QUEUED" },
      });
      return { owner, draft, publishPath };
    }

    for (const format of [
      { extension: "mp4", mimeType: "video/mp4" },
      { extension: "mov", mimeType: "video/quicktime" },
    ]) {
      it(`${format.extension}: direct PUT → real canonical processing → publish → range and decode`, async () => {
        const sourcePath = join(workRoot, `source.${format.extension}`);
        await runProcess(
          ffmpeg,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:sample_rate=48000",
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            sourcePath,
          ],
          processOptions,
        );
        const source = await readFile(sourcePath);
        expect(source.length).toBeLessThan(1024 * 1024);
        const started = performance.now();
        const { owner, draft, publishPath } = await upload(
          format.extension,
          source,
          format.mimeType,
        );
        const queue = app!.get(MediaProcessingQueueService);
        const claim = await queue.claimNext(`connected-${runId}-${format.extension}`);
        expect(claim?.videoId).toBe(draft.video.id);
        expect(claim?.leaseOwner).toBeTruthy();
        await app!.get(MediaProcessingExecutorService).process(claim!, claim!.leaseOwner!);
        const job = await prisma!.mediaProcessingJob.findUniqueOrThrow({
          where: { id: claim!.id },
        });
        expect({ status: job.status, errorCode: job.errorCode }).toEqual({
          status: "READY",
          errorCode: null,
        });
        expect(job.finalAssetId).toBeTruthy();
        const finalAsset = await prisma!.mediaAsset.findUniqueOrThrow({
          where: { id: job.finalAssetId! },
        });
        expect(finalAsset.status).toBe("VALIDATED");
        expect(finalAsset.r2ObjectKey).not.toBe(draft.uploadSession.objectKey);
        expect(finalAsset.mimeType).toBe("video/mp4");
        expect(finalAsset.width).toBe(320);
        expect(finalAsset.height).toBe(180);
        expect(finalAsset.durationMs).toBeGreaterThanOrEqual(1900);
        expect(finalAsset.durationMs).toBeLessThan(2500);
        expect(store.objects.has(draft.uploadSession.objectKey)).toBe(false);
        expect(
          store.operations.some(
            (operation) =>
              operation.method === "DELETE" && operation.key === draft.uploadSession.objectKey,
          ),
        ).toBe(true);
        expect(await readdir(processorRoot)).toEqual([]);
        expect(await queue.claimNext(`connected-idle-${runId}`)).toBeNull();
        const thumbnail = await prisma!.mediaAsset.findFirstOrThrow({
          where: {
            videoId: draft.video.id,
            kind: "THUMBNAIL",
            status: "VALIDATED",
            removedAt: null,
          },
        });
        expect(store.objects.get(thumbnail.r2ObjectKey)?.bytes.length).toBeGreaterThan(0);
        const status = await request(
          "GET",
          `/creator/videos/${draft.video.id}/processing`,
          owner.cookie,
        );
        expect(await status.json()).toMatchObject({ ready: true, processing: { status: "READY" } });
        for (let attempt = 0; attempt < 2; attempt++) {
          const published = await request("POST", publishPath, owner.cookie, {
            rightsConfirmed: true,
          });
          expect(published.status).toBe(201);
          expect(await published.json()).toMatchObject({ video: { status: "PUBLISHED" } });
        }
        expect(
          await prisma!.playlistItem.count({
            where: { videoId: draft.video.id, playlist: { systemKey: "UPLOADS" } },
          }),
        ).toBe(1);
        const playbackResponse = await request(
          "GET",
          `/public/videos/${draft.video.slug}/playback`,
        );
        expect(playbackResponse.status).toBe(200);
        const playback = (await playbackResponse.json()) as {
          video: { source: { objectKey: string; mimeType: string } };
        };
        expect(playback.video.source).toEqual({
          objectKey: finalAsset.r2ObjectKey,
          mimeType: "video/mp4",
        });
        const mediaUrl = store.publicUrl(playback.video.source.objectKey);
        const head = await fetch(mediaUrl, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
        expect(head.status).toBe(200);
        expect(head.headers.get("accept-ranges")).toBe("bytes");
        const ranged = await fetch(mediaUrl, {
          headers: { range: "bytes=0-31" },
          signal: AbortSignal.timeout(10_000),
        });
        expect(ranged.status).toBe(206);
        expect(ranged.headers.get("content-range")).toBe(`bytes 0-31/${finalAsset.sizeBytes}`);
        const remote = await fetch(mediaUrl, { signal: AbortSignal.timeout(10_000) });
        const canonical = Buffer.from(await remote.arrayBuffer());
        expect(canonical.length).toBe(Number(finalAsset.sizeBytes));
        expect(Buffer.from(await ranged.arrayBuffer())).toEqual(canonical.subarray(0, 32));
        const canonicalPath = join(workRoot, `downloaded-${format.extension}.mp4`);
        await writeFile(canonicalPath, canonical);
        const probe = await runProcess(
          ffprobe,
          [
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height",
            "-of",
            "json",
            canonicalPath,
          ],
          processOptions,
        );
        const parsed = JSON.parse(probe.stdout) as { streams: Array<Record<string, unknown>> };
        expect(parsed.streams).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              codec_type: "video",
              codec_name: "h264",
              width: 320,
              height: 180,
            }),
            expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
          ]),
        );
        // Decode the bytes fetched through the public playback-selected object,
        // not the local input or an existence-only HEAD result. -xerror is fatal.
        await runProcess(
          ffmpeg,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-xerror",
            "-i",
            canonicalPath,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-f",
            "null",
            "-",
          ],
          processOptions,
        );
        expect(canonical.indexOf(Buffer.from("moov"))).toBeLessThan(
          canonical.indexOf(Buffer.from("mdat")),
        );
        evidence.push({
          format: format.extension,
          result: "PASS",
          sourceBytes: source.length,
          canonicalBytes: canonical.length,
          sourceSha256: sha256(source),
          canonicalSha256: sha256(canonical),
          dimensions: [320, 180],
          durationMs: finalAsset.durationMs,
          codecs: ["h264", "aac"],
          rangeStatus: 206,
          decodedAudioAndVideo: true,
          duplicateCompleteJobs: 1,
          sourceDeleted: true,
          scratchRemoved: true,
          elapsedMs: Math.round(performance.now() - started),
        });
      }, 60_000);
    }

    it("invalid media bytes cannot become READY or public despite successful storage PUT", async () => {
      const { owner, draft, publishPath } = await upload(
        "invalid",
        Buffer.from("not a video: bounded malformed source"),
        "video/mp4",
      );
      const claim = await app!
        .get(MediaProcessingQueueService)
        .claimNext(`connected-invalid-${runId}`);
      expect(claim?.videoId).toBe(draft.video.id);
      await app!.get(MediaProcessingExecutorService).process(claim!, claim!.leaseOwner!);
      const job = await prisma!.mediaProcessingJob.findUniqueOrThrow({ where: { id: claim!.id } });
      expect(job.status).toBe("QUEUED");
      expect(job.stage).toBe("RETRY_WAIT");
      expect(job.errorCode).toBeTruthy();
      expect(job.finalAssetId).toBeNull();
      expect(
        await prisma!.mediaAsset.count({ where: { videoId: draft.video.id, status: "VALIDATED" } }),
      ).toBe(0);
      expect(
        (await request("POST", publishPath, owner.cookie, { rightsConfirmed: true })).status,
      ).toBe(409);
      expect((await request("GET", `/public/videos/${draft.video.slug}/playback`)).status).toBe(
        404,
      );
      expect(await readdir(processorRoot)).toEqual([]);
      evidence.push({
        format: "invalid-mp4",
        result: "PASS",
        storagePut: 200,
        realProbeRejected: true,
        jobStatus: job.status,
        errorCode: job.errorCode,
        publishStatus: 409,
        publicPlaybackStatus: 404,
        scratchRemoved: true,
      });
    }, 30_000);
  },
);
