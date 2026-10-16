import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

// The same bounded journeys run in Chromium, Firefox and WebKit. These are
// desktop browser engines against an isolated DB and intercepted media, not
// physical-device, R2, worker-processing or Google-provider acceptance.
test("critical account provisioning, access denial, logout and RTL", async ({
  page,
  baseURL,
}, info) => {
  const API = `${new URL(baseURL!).protocol}//127.0.0.1:3001`;
  const email = `critical-${info.project.name}-${Date.now()}@e2e.ayin.test`;
  await page.goto("/register?lang=en");
  await page.getByLabel("Name", { exact: true }).fill("Critical browser creator");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("strong-pass-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Your AYIN channel and TV are ready.")).toBeVisible();
  const bootstrap = JSON.parse(
    execFileSync(
      process.execPath,
      ["tests/e2e/db-helper.mjs", "bootstrap", JSON.stringify({ email })],
      {
        encoding: "utf8",
      },
    ),
  );
  expect(bootstrap).toEqual({ profiles: 1, memberships: 1, uploads: 1, tv: 1 });
  const denied = await page.request.get(`${API}/admin/control/users?take=10&page=1`, {
    headers: { origin: new URL(baseURL!).origin },
  });
  expect(denied.status()).toBe(403);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  expect((await page.request.get(`${API}/auth/me`)).status()).toBe(401);
  await page.goto("/browse?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
});

test("enforced CSP blocks an untrusted script and allows the configured limited-ads SDK", async ({
  page,
}) => {
  await page.route("https://untrusted-script.invalid/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "document.documentElement.dataset.untrustedScript = 'ran'",
    }),
  );
  await page.route("https://pagead2.googlesyndication.com/tag/js/gpt.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "document.documentElement.dataset.trustedSdk = 'ran'",
    }),
  );
  const response = await page.goto("/?lang=en");
  expect(response?.headers()["content-security-policy"]).toContain("script-src");
  // The HTTPS critical harness must exercise the shipped policy unchanged.
  expect(response?.headers()["content-security-policy"]).toContain("upgrade-insecure-requests");
  const rejected = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const script = document.createElement("script");
        script.src = "https://untrusted-script.invalid/probe.js";
        script.onload = () => resolve(false);
        script.onerror = () => resolve(true);
        document.head.append(script);
      }),
  );
  expect(rejected).toBe(true);
  expect(await page.locator("html").getAttribute("data-untrusted-script")).toBeNull();
  const accepted = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const script = document.createElement("script");
        script.src = "https://pagead2.googlesyndication.com/tag/js/gpt.js";
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.append(script);
      }),
  );
  expect(accepted).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-trusted-sdk", "ran");
});

test("supported native media decodes, plays, seeks and releases across the critical browser matrix", async ({
  page,
}, info) => {
  // Prefer production MP4, but CI browser builds may exclude proprietary codecs.
  // Keep the complete playback journey on those engines without certifying AVC.
  const formats = [
    {
      container: "mp4",
      mime: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      contentType: "video/mp4",
      codec: "H.264 baseline/AAC",
      encoder: [
        "-c:v",
        "libx264",
        "-profile:v",
        "baseline",
        "-level:v",
        "3.0",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
      ],
    },
    {
      container: "webm",
      mime: 'video/webm; codecs="vp8, opus"',
      contentType: "video/webm",
      codec: "VP8/Opus",
      encoder: ["-c:v", "libvpx", "-b:v", "300k", "-deadline", "realtime", "-c:a", "libopus"],
    },
    {
      container: "webm",
      mime: 'video/webm; codecs="vp9, opus"',
      contentType: "video/webm",
      codec: "VP9/Opus",
      encoder: ["-c:v", "libvpx-vp9", "-b:v", "300k", "-deadline", "realtime", "-c:a", "libopus"],
    },
  ];
  const support = await page.evaluate((candidates) => {
    const video = document.createElement("video");
    return candidates.map(({ mime }) => ({ mime, supported: video.canPlayType(mime) }));
  }, formats);
  const format = formats.find((_, index) => support[index].supported);
  const codecEvidence = {
    project: info.project.name,
    support,
    selected: format
      ? { container: format.container, mime: format.mime, codec: format.codec }
      : null,
    scope: "Synthetic media in an isolated desktop browser; no device or R2 acceptance.",
    mp4JourneySelected: format?.container === "mp4",
  };
  await info.attach("native-media-codec-evidence", {
    contentType: "application/json",
    body: JSON.stringify(codecEvidence, null, 2),
  });
  // Keep the selected coverage visible on successful runs as well as failure artifacts.
  console.info("Critical native media codec:", JSON.stringify(codecEvidence));
  expect(
    format,
    "The browser must support at least one fixture codec; the playback journey cannot be skipped",
  ).toBeDefined();
  if (!format) throw new Error("No supported native media fixture codec");
  const scratch = mkdtempSync(path.join(os.tmpdir(), "ayin-browser-media-"));
  try {
    const file = path.join(scratch, `fixture.${format.container}`);
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "4",
      "-pix_fmt",
      "yuv420p",
      ...format.encoder,
      file,
    ]);
    const fixture = JSON.parse(
      execFileSync(process.execPath, ["tests/e2e/db-helper.mjs", "seed-player-video", "{}"], {
        encoding: "utf8",
      }),
    ) as { id: string; slug: string; sourceKey: string };
    const bytes = readFileSync(file);
    let mediaRequests = 0;
    await page.route(
      (url) =>
        ["http:", "https:"].includes(url.protocol) &&
        url.hostname === "media.invalid" &&
        url.pathname === `/${fixture.sourceKey}`,
      (route) => {
        mediaRequests++;
        // Match byte-range storage semantics: without this, WebM is treated as a
        // nonseekable stream even when the complete short fixture was transferred.
        const requestedRange = route.request().headers().range;
        const range = requestedRange?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        if ((requestedRange && !range) || start > end || start >= bytes.length) {
          return route.fulfill({
            status: 416,
            headers: { "content-range": `bytes */${bytes.length}` },
          });
        }
        const body = bytes.subarray(start, end + 1);
        return route.fulfill({
          status: range ? 206 : 200,
          contentType: format.contentType,
          body,
          headers: {
            "access-control-allow-origin": "*",
            "accept-ranges": "bytes",
            "content-length": String(body.length),
            ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
          },
        });
      },
    );
    await page.route("**/ads/video/decision/**", (route) =>
      route.fulfill({ json: { enabled: false } }),
    );
    await page.goto(`/watch/${fixture.slug}?lang=en`);
    const video = page.locator("video:visible");
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    expect(mediaRequests).toBeGreaterThan(0);
    await video.evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.muted = true;
    });
    await page.getByRole("button", { name: "Play video", exact: true }).click();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0);
    await video.evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = 2;
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeCloseTo(2, 1);
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => !element.seeking && element.readyState >= 2),
      )
      .toBe(true);
    const retained = await video.elementHandle();
    await page.locator('a[href="/"]').first().click();
    await expect(page).toHaveURL(/\/$/);
    expect(
      await retained!.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        source: element.getAttribute("src"),
      })),
    ).toEqual({ paused: true, source: null });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("candidate CSP enforces exact API origins and blocks inline handlers in isolation", async ({
  page,
  baseURL,
}) => {
  const API = `${new URL(baseURL!).protocol}//127.0.0.1:3001`;
  let candidateApplied = false;
  await page.route("**/login?csp-candidate=1", async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    const candidate = headers["content-security-policy-report-only"];
    if (!candidate)
      throw new Error("Build with AYIN_CSP_REPORT_ONLY=true for candidate acceptance.");
    delete headers["content-security-policy-report-only"];
    // Candidate enforcement retains production transport upgrades as well.
    expect(headers["content-security-policy"]).toContain("upgrade-insecure-requests");
    headers["content-security-policy"] = `${candidate}; upgrade-insecure-requests`;
    candidateApplied = true;
    await route.fulfill({ response, headers });
  });
  await page.route("https://untrusted-connect.invalid/**", (route) =>
    route.fulfill({
      json: { unexpected: true },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.goto("/login?csp-candidate=1");
  expect(candidateApplied).toBe(true);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await page.evaluate(async (api) => (await fetch(`${api}/health`)).ok, API)).toBe(true);
  expect(
    await page.evaluate(async () => {
      try {
        await fetch("https://untrusted-connect.invalid/probe");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.setAttribute("onclick", "document.documentElement.dataset.inlineHandler = 'ran'");
    document.body.append(button);
    button.click();
    button.remove();
  });
  expect(await page.locator("html").getAttribute("data-inline-handler")).toBeNull();
});
