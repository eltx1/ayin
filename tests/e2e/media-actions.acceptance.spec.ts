import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
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

test("media actions require confirmation and fresh assurance, queue once and retain audited outcomes", async ({
  page,
}) => {
  db("reset");
  db("reset-operator-state");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Media operator",
      email: "media-actions@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  const { secret } = await enrollMfa(page.request);
  const { jobId, videoId } = db("seed-operator-job", { channelId: user.channel.id });
  // No operator role: neither a write nor the workspace is available.
  expect(
    (
      await page.request.post(`${API}/admin/media-processing/jobs/${jobId}/retry`, {
        headers: { origin: WEB },
      })
    ).status(),
  ).toBe(403);
  db("grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  // Age only assurance in a legitimately issued test session; keep session, MFA and expiry.
  // Sign with the fixed E2E server key so the real guard, not a mocked 403, is exercised.
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.value.startsWith("v1."));
  expect(session).toBeDefined();
  const payload = JSON.parse(Buffer.from(session!.value.split(".")[1], "base64url").toString());
  payload.reauthAt = Math.floor(Date.now() / 1000) - 600;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", "task-29-e2e-auth-secret-with-more-than-32-characters")
    .update(encoded)
    .digest("base64url");
  await page.context().addCookies([{ ...session!, value: `v1.${encoded}.${signature}` }]);
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/admin/media-processing/")) writes++;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/operations/media");
  const retry = page.getByRole("button", { name: "Retry processing", exact: true });
  await retry.click();
  const confirmation = page.getByRole("dialog", { name: "Retry processing", exact: true });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(retry).toBeFocused();
  expect(writes).toBe(0);
  await retry.click();
  await confirmation.getByRole("button", { name: "Confirm and queue" }).click();
  const verification = page.getByRole("dialog", { name: "Confirm your identity" });
  await expect(verification).toBeVisible();
  expect(db("operator-action-evidence", { videoId, accountId: user.account.id }).audits).toEqual(
    [],
  );
  await verification.getByLabel("Password", { exact: true }).fill("strong-pass-123");
  await verification
    .getByLabel("Authenticator code")
    .fill(generateTotpCode(secret, totpCounter() + 1n));
  await verification.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(verification).not.toBeVisible();
  await expect(retry).toBeVisible();
  expect(writes).toBe(1); // Successful verification did not replay the action.
  await retry.click();
  await confirmation.getByRole("button", { name: "Confirm and queue" }).click();
  await expect(page.getByRole("status").filter({ hasText: "generation 1 queued" })).toBeVisible();
  await expect(retry).not.toBeVisible();
  expect(writes).toBe(2);
  let evidence = db("operator-action-evidence", { videoId, accountId: user.account.id });
  expect(evidence.jobs).toEqual([{ id: jobId, generation: 1, status: "QUEUED" }]);
  expect(evidence.audits).toEqual([{ action: "media_processing.retry", entityId: jobId }]);
  // E2E has no worker. Seed its validated output to exercise real reprocess HTTP/DB behavior.
  db("operator-ready-source", { jobId });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Reprocess video", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Reprocess video", exact: true })
    .getByRole("button", { name: "Confirm and queue" })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "generation 2 queued" })).toBeVisible();
  evidence = db("operator-action-evidence", { videoId, accountId: user.account.id });
  expect(
    evidence.jobs.map((job: { generation: number; status: string }) => [
      job.generation,
      job.status,
    ]),
  ).toEqual([
    [1, "READY"],
    [2, "QUEUED"],
  ]);
  expect(evidence.audits).toHaveLength(2);
  expect(evidence.audits).toContainEqual({
    action: "media_processing.reprocess",
    entityId: videoId,
  });
  await expect(
    page.getByRole("button", { name: "Reprocess video", exact: true }),
  ).not.toBeVisible();
  expect(writes).toBe(3);
  db("operator-ready-source", { jobId: evidence.jobs[1].id });
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  await page.reload();
  await page.getByRole("button", { name: "إعادة معالجة الفيديو", exact: true }).click();
  const arabic = page.getByRole("dialog", { name: "إعادة معالجة الفيديو", exact: true });
  await expect(arabic).toHaveAttribute("dir", "rtl");
  const bounds = await arabic.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  // A second operator queues a generation after this browser's confirmation was opened.
  const concurrent = await page.request.post(
    `${API}/admin/media-processing/videos/${videoId}/reprocess`,
    { headers: { origin: WEB } },
  );
  expect(concurrent.ok()).toBeTruthy();
  await arabic.getByRole("button", { name: "تأكيد وإدراج في الطابور" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already has an active" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "إعادة معالجة الفيديو", exact: true }),
  ).not.toBeVisible();
  evidence = db("operator-action-evidence", { videoId, accountId: user.account.id });
  expect(evidence.jobs).toHaveLength(3);
  expect(evidence.audits).toHaveLength(3); // Rejected stale confirmation adds no audit/job.

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
