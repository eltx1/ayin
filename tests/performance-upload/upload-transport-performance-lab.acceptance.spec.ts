import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance as clock } from "node:perf_hooks";
import { expect, test } from "@playwright/test";
import { performanceLabProfiles } from "../e2e/performance-lab-profiles";
import { observeRuntime } from "../e2e/performance-lab-observer";
import { runtimeSourceEvidence } from "../e2e/performance-lab-provenance";

const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000",
  PROVIDER = "http://127.0.0.1:3012";
type Phase = {
  phase: string;
  started: number;
  response: number | null;
  finished: number | null;
  status: number | null;
  sendStartMs: number | null;
  sendEndMs: number | null;
  failed: boolean;
  responseEncodedBytes: number | null;
};
const family = (raw: string, method: string) => {
  const url = new URL(raw);
  if (url.origin !== API) return null;
  if (method === "PUT" && url.pathname.startsWith("/_test/recovery-byte-store/"))
    return "synthetic-byte-put";
  if (method !== "POST") return null;
  if (url.pathname === "/creator/videos/drafts") return "application-draft";
  if (url.pathname === "/media/uploads/sessions/complete") return "application-upload-completion";
  if (/^\/creator\/videos\/[^/]+\/upload-complete$/.test(url.pathname))
    return "application-creator-confirmation";
  return null;
};
for (const profile of performanceLabProfiles)
  test(`direct browser upload ${profile.name}`, async ({ browser, request }, info) => {
    const source = await runtimeSourceEvidence(browser.version(), [
      "apps/api/test/support/upload-recovery-browser-server.ts",
      "playwright.upload-transport.config.ts",
      "tests/performance-upload/upload-transport-performance-lab.acceptance.spec.ts",
      "tests/e2e/fixtures/clips-viewport.webm",
    ]);
    expect(source.trackedWorktreeClean).toBe(true);
    const bytes = await readFile(path.resolve("tests/e2e/fixtures/clips-viewport.webm"));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const samples: unknown[] = [];
    let complete = false,
      cleaned = false;
    let cleanupError: unknown;
    const reset = async () =>
      expect((await request.post(`${PROVIDER}/control`, { data: { reset: true } })).ok()).toBe(
        true,
      );
    try {
      for (let index = 0; index < 3; index++) {
        await reset();
        const context = await browser.newContext({
          viewport: profile.viewport,
          locale: "en-US",
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        const phases: Phase[] = [],
          active = new Map<string, Phase>();
        let observation: Awaited<ReturnType<typeof observeRuntime>> | null = null;
        let started = 0,
          successful = false;
        let persistedAcknowledgement: unknown = null;
        try {
          const registration = await context.request.post(`${API}/auth/register`, {
            headers: { origin: WEB },
            data: {
              name: "Synthetic transfer owner",
              email: `transport-${randomUUID()}@e2e.ayin.test`,
              password: "strong-pass-123",
            },
          });
          expect(registration.ok()).toBe(true);
          observation = await observeRuntime(page, profile);
          observation.cdp.on("Network.requestWillBeSent", (event) => {
            const name = family(event.request.url, event.request.method);
            if (!name) return;
            const phase: Phase = {
              phase: name,
              started: event.timestamp,
              response: null,
              finished: null,
              status: null,
              sendStartMs: null,
              sendEndMs: null,
              failed: false,
              responseEncodedBytes: null,
            };
            active.set(event.requestId, phase);
            phases.push(phase);
          });
          observation.cdp.on("Network.responseReceived", (event) => {
            const phase = active.get(event.requestId);
            if (!phase) return;
            phase.response = event.timestamp;
            phase.status = event.response.status;
            phase.sendStartMs = event.response.timing?.sendStart ?? null;
            phase.sendEndMs = event.response.timing?.sendEnd ?? null;
          });
          observation.cdp.on("Network.loadingFinished", (event) => {
            const phase = active.get(event.requestId);
            if (phase) {
              phase.finished = event.timestamp;
              phase.responseEncodedBytes = event.encodedDataLength;
            }
          });
          observation.cdp.on("Network.loadingFailed", (event) => {
            const phase = active.get(event.requestId);
            if (phase) phase.failed = true;
          });
          await page.goto(`${WEB}/upload`, { waitUntil: "domcontentloaded" });
          const fileInput = page
            .locator('main:visible input[type="file"][accept^="video/"]')
            .first();
          await expect(fileInput).toBeEnabled();
          started = clock.now();
          await fileInput.setInputFiles({
            name: "synthetic-local-transfer.webm",
            mimeType: "video/webm",
            buffer: bytes,
          });
          await expect(
            page
              .locator("main:visible")
              .getByText(
                "Upload complete. AYIN is preparing a reliable playback version in the background.",
                { exact: true },
              ),
          ).toBeVisible();
          const selectionToQueuedUiMs = clock.now() - started;
          const statsResponse = await request.get(`${PROVIDER}/stats`);
          expect(statsResponse.ok()).toBe(true);
          const stats = await statsResponse.json();
          persistedAcknowledgement = stats;
          expect(stats).toMatchObject({
            allocations: 0,
            authorizations: 1,
            puts: 1,
            completes: 0,
            uploadedSources: 1,
            processingQueued: 1,
            validatingVideos: 1,
            published: 0,
          });
          expect(stats.received).toHaveLength(1);
          expect(stats.received[0]).toMatchObject({
            bytes: bytes.length,
            sha256,
            cookiePresent: false,
            authorizationPresent: false,
          });
          expect(stats.storedObjects).toEqual([
            { bytes: bytes.length, sha256, contentType: "video/webm" },
          ]);
          for (const name of [
            "synthetic-byte-put",
            "application-draft",
            "application-upload-completion",
            "application-creator-confirmation",
          ]) {
            const matching = phases.filter((phase) => phase.phase === name);
            expect(matching).toHaveLength(1);
            expect(matching[0]!.failed).toBe(false);
            expect(matching[0]!.status).toBeGreaterThanOrEqual(200);
            expect(matching[0]!.status).toBeLessThan(300);
            expect(matching[0]!.finished).not.toBeNull();
          }
          const put = phases.find((phase) => phase.phase === "synthetic-byte-put")!;
          const acknowledgement = phases.find(
            (phase) => phase.phase === "application-creator-confirmation",
          )!;
          samples.push({
            index,
            successful: true,
            selectionToQueuedUiMs,
            putFinishToCreatorAcknowledgementMs: (acknowledgement.finished! - put.finished!) * 1000,
            phases: phases.map((phase) => ({
              ...phase,
              requestToResponseObservedMs:
                phase.response === null ? null : (phase.response - phase.started) * 1000,
              requestToResponseFinishedMs:
                phase.finished === null ? null : (phase.finished - phase.started) * 1000,
              cdpSendIntervalMs:
                phase.sendStartMs !== null &&
                phase.sendEndMs !== null &&
                phase.sendStartMs >= 0 &&
                phase.sendEndMs >= phase.sendStartMs
                  ? phase.sendEndMs - phase.sendStartMs
                  : null,
            })),
            persistedAcknowledgement: stats,
            runtime: await observation.snapshot(),
          });
          successful = true;
        } finally {
          if (!successful) {
            if (persistedAcknowledgement === null) {
              try {
                const response = await request.get(`${PROVIDER}/stats`, { timeout: 5000 });
                if (response.ok()) persistedAcknowledgement = await response.json();
              } catch {
                // Preserve the primary browser/application failure even if the
                // synthetic provider is unreachable; do not fabricate state.
              }
            }
            samples.push({
              index,
              successful: false,
              elapsedSinceSelectionMs: started ? clock.now() - started : null,
              phases,
              persistedAcknowledgement,
              providerStateObserved: persistedAcknowledgement !== null,
              runtime: observation ? await observation.snapshot().catch(() => null) : null,
            });
          }
          await observation?.detach().catch(() => undefined);
          await context.close();
        }
      }
      complete = true;
    } finally {
      try {
        await reset();
        const after = await (await request.get(`${PROVIDER}/stats`)).json();
        cleaned =
          after.puts === 0 &&
          after.uploadedSources === 0 &&
          after.processingQueued === 0 &&
          after.published === 0 &&
          after.storedObjects.length === 0;
      } catch (error) {
        cleanupError = error;
      }
      await writeFile(
        info.outputPath("upload-transport-runtime.json"),
        JSON.stringify(
          {
            schemaVersion: 2,
            capturedAt: new Date().toISOString(),
            source,
            profile,
            browserConfiguration: {
              cacheDisabled: true,
              serviceWorkers: "block",
              trace: "off",
              samplesPerProfile: 3,
              locale: "en-US",
            },
            complete,
            cleaned,
            cleanupFailed: cleanupError !== undefined,
            fixture: {
              bytes: bytes.length,
              sha256,
              container: "WebM",
              codec: "VP8",
              durationSeconds: 30,
              width: 96,
              height: 160,
            },
            samples,
            limits: [
              "Six serialized single-object Quick Upload samples in fresh contexts; exact tiny synthetic local file, no multipart or capacity claim",
              "Browser XHR PUT reaches a guarded synthetic raw-byte route on allowed API origin3001; no Playwright routing or Node forwarding; original recovery nonce/grant/store and actual application completion contract are retained",
              "CDP send interval measures browser network-stack sending. responseReceived timestamps are protocol observations, not network header-arrival times, and may follow loadingFinished timestamps. Do not subtract them as response-body duration. Server body receive interval is separate. Encoded data length is response bytes, not upload bytes",
              "Persisted source UPLOADED and job QUEUED follow real application completion and creator confirmation. No fixture state is set to manufacture acceptance; no worker runs and no video is published",
              "Controlled loopback/CDP upload settings and tiny WebM do not establish R2/CDN throughput, field speed, remote TLS or production provider admission",
              "API executes test-only Nest DI from this source; production bootstrap remains unchanged and its Unsupported provider admission is not certified",
              "Event Timing is lab event timing, not field INP. Browser request counts exclude server-side API and DB work",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    }
    expect(cleanupError).toBeUndefined();
    expect(cleaned).toBe(true);
  });
