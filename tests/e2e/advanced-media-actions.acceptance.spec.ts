import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
function db(command: string, payload: Record<string, unknown> = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
async function setup(page: Page, suffix: string) {
  db("reset");
  db("reset-operator-state");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Adaptive operator",
      email: `adaptive-${suffix}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  await enrollMfa(page.request);
  db("grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  db("configure-adaptive-operator");
  return user;
}
async function confirm(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
}
async function openMaintenance(page: Page) {
  await page.goto("/admin/operations/media");
  await page.getByText("Advanced media maintenance", { exact: true }).click();
}
test.afterEach(() => {
  db("reset-adaptive-operator");
});

test("advanced actions enforce role, capacity, audit/no-op and pause semantics through real HTTP", async ({
  page,
}) => {
  const user = await setup(page, "real");
  const { jobId, videoId } = db("seed-operator-job", { channelId: user.channel.id });
  db("operator-ready-source", { jobId }); // E2E has no worker: seed validated source, not encoding success.
  db("configure-adaptive-operator", { videoId });
  await openMaintenance(page);
  await expect(
    page.getByRole("button", { name: "Pause catalog conversion", exact: true }),
  ).not.toBeVisible();
  expect(
    (
      await page.request.post(`${API}/admin/media-processing/adaptive-rollout/backfill/pause`, {
        headers: { origin: WEB },
      })
    ).status(),
  ).toBe(403);
  await expect(page.locator('option[value="INCOMPLETE_HLS"]')).toHaveCount(1);
  const convert = page.getByRole("button", { name: "Convert a catalog batch", exact: true });
  await page.getByLabel("Maximum items per action").fill("0");
  await expect(convert).toBeDisabled();
  await page.getByLabel("Maximum items per action").fill("2");
  await convert.click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(convert).toBeFocused();
  expect(db("adaptive-action-evidence", { accountId: user.account.id }).audits).toHaveLength(0);
  await confirm(page, "Convert a catalog batch");
  await expect(
    page.getByRole("status").filter({ hasText: "Queued 1; processing is not complete" }),
  ).toBeVisible();
  let evidence = db("adaptive-action-evidence", { accountId: user.account.id });
  expect(evidence.audits).toHaveLength(1);
  expect(evidence.audits[0]).toMatchObject({
    action: "media_adaptive.backfill_batch",
    metadata: { enqueued: 1 },
  });
  // The same batch at full capacity must not claim another queued job.
  await confirm(page, "Convert a catalog batch");
  await expect(page.getByRole("status").filter({ hasText: "Capacity is full" })).toBeVisible();
  db("grant-operator-role", { accountId: user.account.id, role: "SUPERADMIN" });
  await openMaintenance(page);
  await confirm(page, "Pause catalog conversion");
  await expect(
    page.getByRole("status").filter({ hasText: "Existing jobs were not cancelled" }),
  ).toBeVisible();
  await expect(convert).toBeDisabled();
  await confirm(page, "Review recovery"); // Expired-worker recovery remains available while paused.
  await expect(page.getByRole("status").filter({ hasText: "Marked 0 jobs failed" })).toBeVisible();
  await confirm(page, "Resume catalog conversion");
  await expect(convert).toBeEnabled();
  await convert.click();
  // Another operator pauses after the confirmation snapshot was opened.
  expect(
    (
      await page.request.post(`${API}/admin/media-processing/adaptive-rollout/backfill/pause`, {
        headers: { origin: WEB },
      })
    ).ok(),
  ).toBeTruthy();
  const auditsBefore = db("adaptive-action-evidence", { accountId: user.account.id }).audits.length;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "No action or audit was created" }),
  ).toBeVisible();
  evidence = db("adaptive-action-evidence", { accountId: user.account.id });
  expect(evidence.audits).toHaveLength(auditsBefore);
  expect(evidence.audits.map((row: { action: string }) => row.action)).toContain(
    "media_adaptive.backfill_resume",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  await page.reload();
  await page.getByText("صيانة الوسائط المتقدمة", { exact: true }).click();
  await page.getByRole("button", { name: "استئناف التحويل", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("dir", "rtl");
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("storage scan UI preserves manual continuation, pending protection and mode context", async ({
  page,
}) => {
  await setup(page, "scan");
  // Browser contract fixtures only; real storage/database behavior is covered by PostgreSQL tests.
  const bodies: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cursor = "00000000-0000-4000-8000-000000000001";
  await page.route("**/adaptive-rollout/recovery", async (route) => {
    bodies.push(route.request().postDataJSON());
    const n = bodies.length;
    if (n === 1) await pending;
    if (n === 4)
      return route.fulfill({
        status: 503,
        json: {
          error: { code: "STORAGE_UNAVAILABLE", message: "Storage verification unavailable" },
        },
      });
    await route.fulfill({
      json: {
        mode: "VERIFIED_HLS_MISSING_DB",
        detected: n === 1 ? 2 : 0,
        requeued: n === 1 ? 1 : 0,
        scanned: 2,
        nextCursor: n === 2 ? cursor : null,
        hasMore: n < 3,
      },
    });
  });
  await openMaintenance(page);
  await page.getByLabel("Recovery action", { exact: true }).selectOption("VERIFIED_HLS_MISSING_DB");
  await confirm(page, "Review recovery");
  await expect(page.getByRole("button", { name: "Review recovery", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Convert a catalog batch", exact: true }),
  ).toBeDisabled();
  expect(bodies).toHaveLength(1);
  release();
  await expect(page.getByRole("button", { name: "Continue scan", exact: true })).toBeEnabled();
  expect(bodies).toHaveLength(1); // Never automatically scan or replay after refresh.
  await confirm(page, "Continue scan");
  await expect(page.getByRole("button", { name: "Continue scan", exact: true })).toBeEnabled();
  expect(bodies[1]).not.toHaveProperty("cursor"); // Null + hasMore resumes the initial range.
  await confirm(page, "Continue scan");
  await expect(
    page.getByRole("status").filter({ hasText: "The current scan range is complete" }),
  ).toBeVisible();
  expect(bodies[2]?.cursor).toBe(cursor);
  await page.getByLabel("Recovery action", { exact: true }).selectOption("DB_MANIFEST_MISSING");
  await expect(page.getByRole("button", { name: "Continue scan", exact: true })).not.toBeVisible();
  await confirm(page, "Review recovery");
  await expect(
    page.getByRole("alert").filter({ hasText: "Storage verification unavailable" }),
  ).toBeVisible();
  expect(bodies).toHaveLength(4);
  expect(bodies[3]).not.toHaveProperty("cursor");
  await expect(page.getByLabel("Recovery action", { exact: true })).toHaveValue(
    "DB_MANIFEST_MISSING",
  );
});

test("incomplete playback recovery uses reviewed scope and commits a new generation with audit", async ({
  page,
}) => {
  const user = await setup(page, "incomplete");
  const { jobId, videoId } = db("seed-operator-job", { channelId: user.channel.id });
  db("operator-ready-source", { jobId });
  db("configure-adaptive-operator", { videoId });
  const { generationId } = db("seed-incomplete-playback", { videoId });
  await openMaintenance(page);
  await page.getByLabel("Recovery action", { exact: true }).selectOption("INCOMPLETE_HLS");
  await page.getByLabel("Maximum items per action").fill("1");
  await page.getByRole("button", { name: "Review recovery", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Recover incomplete adaptive playback");
  await expect(page.getByRole("dialog")).toContainText(
    "Obsolete generations and active work are excluded",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    db("incomplete-action-evidence", { videoId, generationId, accountId: user.account.id }).jobs,
  ).toHaveLength(1);
  await confirm(page, "Review recovery");
  await expect(page.getByText(/Queued 1; processing is not complete/)).toBeVisible();
  const evidence = db("incomplete-action-evidence", {
    videoId,
    generationId,
    accountId: user.account.id,
  });
  expect(evidence.generation).toMatchObject({
    status: "SUPERSEDED",
    supersededAt: expect.any(String),
  });
  expect(evidence.jobs).toEqual([
    { generation: 1, status: "READY" },
    { generation: 2, status: "QUEUED" },
  ]);
  expect(evidence.audits).toHaveLength(1);
  expect(evidence.audits[0].metadata).toMatchObject({
    mode: "INCOMPLETE_HLS",
    detected: 1,
    requeued: 1,
  });
  await confirm(page, "Review recovery");
  await expect(page.getByText(/Capacity is full/)).toBeVisible();
  expect(
    db("incomplete-action-evidence", { videoId, generationId, accountId: user.account.id }).jobs,
  ).toHaveLength(2);
});
