import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const PROVIDER = "http://127.0.0.1:3012";
const MIB = 1024 ** 2;
const SIZE = 129 * MIB;
const PART = 5 * MIB;
type TransferStats = {
  allocations: number;
  authorizations: number;
  puts: number;
  completes: number;
  sessions: number;
  queued: number;
  processingQueued: number;
  published: number;
  received: {
    partNumber: number;
    bytes: number;
    sha256: string;
    cookiePresent: boolean;
    authorizationPresent: boolean;
  }[];
  multipartInventory: { partNumber: number; bytes: number }[][];
  storedObjects: { bytes: number; sha256: string; contentType: string }[];
  rejectedPuts: { partNumber: number; bytes: number; status: number }[];
};

async function register(request: APIRequestContext, email: string) {
  const response = await request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Large recovery owner", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
}

async function realFixtures() {
  const directory = await mkdtemp(path.join(tmpdir(), "ayin-large-upload-"));
  await mkdir(path.join(directory, "original"));
  await mkdir(path.join(directory, "changed"));
  const original = path.join(directory, "original", "reload-129-mib.mp4");
  const changed = path.join(directory, "changed", "reload-129-mib.mp4");
  const block = Buffer.alloc(MIB);
  for (let offset = 0; offset < block.length; offset++)
    block[offset] = (offset * 31 + (offset >>> 8) + 17) & 255;
  const hash = createHash("sha256");
  const file = await open(original, "w");
  try {
    for (let count = 0; count < 129; count++) {
      await file.writeFile(block);
      hash.update(block);
    }
  } finally {
    await file.close();
  }
  await copyFile(original, changed);
  const substitute = await open(changed, "r+");
  const middle = Math.floor(SIZE / 2);
  try {
    await substitute.write(Buffer.from([block[middle % MIB]! ^ 255]), 0, 1, middle);
  } finally {
    await substitute.close();
  }
  // Name, size and browser lastModified are identical: only full-file identity
  // can reject this substitute, whose first and last chunks also match.
  const modified = new Date("2025-01-01T00:00:00.000Z");
  await Promise.all([utimes(original, modified, modified), utimes(changed, modified, modified)]);
  const [left, right] = await Promise.all([stat(original), stat(changed)]);
  expect(left.size).toBe(SIZE);
  expect(right.size).toBe(SIZE);
  expect(left.mtimeMs).toBe(right.mtimeMs);
  return { directory, original, changed, sha256: hash.digest("hex") };
}

// Runs only with playwright.upload-large-recovery.config.ts. This is actual
// browser HTTP byte transfer to isolated synthetic storage + real PostgreSQL,
// not a declared-size fake, R2/codec acceptance, or the separate 3.48 GiB proof.
test("primary upload resumes actual 129 MiB after reload and rejects a same-metadata substitute", async ({
  page,
  context,
  browser,
}, info) => {
  const stats = async (): Promise<TransferStats> =>
    (await page.request.get(`${PROVIDER}/stats`)).json();
  expect(
    (
      await page.request.post(`${PROVIDER}/control`, { data: { reset: true, failPutPartOnce: 4 } })
    ).ok(),
  ).toBe(true);
  await register(page.request, "large-recovery@e2e.ayin.test");
  const fixture = await realFixtures();
  let held = false;
  let inspectionUrl = "";
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    // Observe the authoritative inventory after the first concurrent batch.
    // No provider PUT is intercepted, fulfilled, or forwarded by Playwright.
    await page.route("**/media/uploads/sessions/*/inspection", async (route) => {
      const response = await route.fetch();
      const snapshot = await response.json();
      inspectionUrl = route.request().url();
      if (
        !held &&
        snapshot.observation?.kind === "PARTS_OBSERVED" &&
        snapshot.observation.parts.length === 3
      ) {
        held = true;
        await barrier;
        await route.abort("internetdisconnected").catch(() => undefined);
      } else await route.fulfill({ response });
    });
    await page.goto("/upload?lang=en");
    const upload = page.getByRole("region", { name: "Creator upload", exact: true });
    const picker = upload.locator('input[type="file"][accept^="video/"]');
    await expect(picker).toHaveCount(1);
    await expect(picker).toBeEnabled();
    await picker.setInputFiles(fixture.original);
    await expect.poll(() => held, { timeout: 90_000 }).toBe(true);
    const interrupted = await stats();
    expect(interrupted).toMatchObject({
      allocations: 1,
      authorizations: 3,
      puts: 3,
      completes: 0,
      sessions: 1,
      queued: 0,
      published: 0,
    });
    expect(interrupted.multipartInventory).toEqual([
      [1, 2, 3].map((partNumber) => ({ partNumber, bytes: PART })),
    ]);

    // A different signed-in account cannot inspect this still-open upload.
    const outsider = await browser.newContext({ baseURL: WEB });
    try {
      await register(outsider.request, "other-large-recovery@e2e.ayin.test");
      const denied = await outsider.request.get(inspectionUrl);
      expect(denied.status()).toBe(404);
      expect(await denied.json()).toMatchObject({ error: { code: "UPLOAD_RECOVERY_NOT_FOUND" } });
    } finally {
      await outsider.close();
    }
    expect(await stats()).toMatchObject({ allocations: 1, puts: 3, completes: 0 });

    // Ordinary tab switching hides private UI but must preserve this explicit
    // transfer. The held inventory prevents a fourth PUT during this check.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(upload.getByRole("button", { name: "Pause upload", exact: true })).toBeEnabled();
    await expect(upload.getByRole("button", { name: "Continue upload", exact: true })).toHaveCount(
      0,
    );
    expect(await stats()).toMatchObject({
      allocations: 1,
      authorizations: 3,
      puts: 3,
      completes: 0,
    });

    // Reload while an actual upload is active. The browser loses File objects
    // and in-memory grants; only the persisted descriptor and server bytes remain.
    page.once("dialog", (dialog) => dialog.accept());
    await page.unroute("**/media/uploads/sessions/*/inspection");
    const reloading = page.reload();
    release();
    await reloading;
    const saved = upload.getByRole("region", { name: "Saved upload", exact: true });
    await expect(saved).toBeVisible();
    const reselect = saved.getByLabel("Reselect original video", { exact: true });
    await expect(reselect).toBeEnabled();
    expect(await reselect.inputValue()).toBe("");
    expect(await stats()).toMatchObject({ allocations: 1, puts: 3, completes: 0, sessions: 1 });

    await reselect.setInputFiles(fixture.changed);
    await expect(upload.getByRole("alert")).toContainText("This is not the original video");
    await expect(reselect).toBeEnabled();
    expect(await stats()).toMatchObject({
      allocations: 1,
      authorizations: 3,
      puts: 3,
      completes: 0,
      sessions: 1,
    });
    await reselect.setInputFiles(fixture.original);
    // Part 4 receives a real HTTP 503 before storage. This single explicit
    // resume must recover automatically without another click or reallocation.
    await expect.poll(async () => (await stats()).queued, { timeout: 120_000 }).toBe(1);
    const completed = await stats();
    expect(completed).toMatchObject({
      allocations: 1,
      puts: 26,
      completes: 1,
      sessions: 1,
      queued: 1,
      processingQueued: 0,
      published: 0,
      multipartInventory: [],
    });
    expect(completed.rejectedPuts).toEqual([{ partNumber: 4, bytes: PART, status: 503 }]);
    // The failed batch may cancel either/both sibling PUTs before acceptance.
    // Only its missing parts may receive new grants; accepted parts stay unique.
    expect(completed.authorizations).toBeGreaterThanOrEqual(27);
    expect(completed.authorizations).toBeLessThanOrEqual(29);
    const received = [...completed.received].sort((a, b) => a.partNumber - b.partNumber);
    expect(received.map((part) => part.partNumber)).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
    expect(received.map((part) => part.bytes)).toEqual([...Array(25).fill(PART), 4 * MIB]);
    expect(received.reduce((sum, part) => sum + part.bytes, 0)).toBe(SIZE);
    for (const part of received)
      expect(part).toMatchObject({ cookiePresent: false, authorizationPresent: false });
    expect(completed.storedObjects).toEqual([
      { bytes: SIZE, sha256: fixture.sha256, contentType: "video/mp4" },
    ]);
    // Integrity and processing have merely queued; this test cannot claim READY.
    // Recovery leads to the existing Studio editor, preserving saved metadata.
    await expect(upload.getByRole("button", { name: "Publish video", exact: true })).toHaveCount(0);
    await expect(upload.getByRole("button", { name: "Save details", exact: true })).toHaveCount(0);
    const evidence = JSON.stringify(
      {
        evidence: "isolated-synthetic-byte-transfer",
        expectedBytes: SIZE,
        interrupted,
        completed,
      },
      null,
      2,
    );
    // The list reporter does not persist in-memory attachments into the CI ZIP.
    await writeFile(info.outputPath("actual-129-mib-reload-result.json"), evidence);
    await info.attach("actual-129-mib-reload-result", {
      body: evidence,
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("actual-129-mib-recovered.png") });
  } finally {
    release();
    await context.setOffline(false);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
