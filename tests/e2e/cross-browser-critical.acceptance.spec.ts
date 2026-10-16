import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";

// The same bounded journeys run in Chromium, Firefox and WebKit. These are
// desktop browser engines against an isolated DB and intercepted media, not
// physical-device, R2, worker-processing or Google-provider acceptance.
test("critical account provisioning, access denial, logout and RTL", async ({ page }, info) => {
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
    headers: { origin: WEB },
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

test("native MP4 decode, play, seek and release survive the critical browser matrix", async ({
  page,
}) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "ayin-browser-media-"));
  try {
    const file = path.join(scratch, "fixture.mp4");
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
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      file,
    ]);
    const fixture = JSON.parse(
      execFileSync(process.execPath, ["tests/e2e/db-helper.mjs", "seed-player-video", "{}"], {
        encoding: "utf8",
      }),
    ) as { id: string; slug: string; sourceKey: string };
    const bytes = readFileSync(file);
    await page.route(`http://media.invalid/${fixture.sourceKey}`, (route) =>
      route.fulfill({
        contentType: "video/mp4",
        body: bytes,
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    await page.route("**/ads/video/decision/**", (route) =>
      route.fulfill({ json: { enabled: false } }),
    );
    await page.goto(`/watch/${fixture.slug}?lang=en`);
    const video = page.locator("video:visible");
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
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
}) => {
  let candidateApplied = false;
  await page.route("**/login?csp-candidate=1", async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    const candidate = headers["content-security-policy-report-only"];
    if (!candidate)
      throw new Error("Build with AYIN_CSP_REPORT_ONLY=true for candidate acceptance.");
    delete headers["content-security-policy-report-only"];
    headers["content-security-policy"] = candidate;
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
