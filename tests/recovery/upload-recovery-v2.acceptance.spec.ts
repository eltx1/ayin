import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

// Isolated synthetic HTTP storage, real PostgreSQL and the real V2 controller.
// No R2 credentials or live provider claim. Browser PUTs are never route-forwarded.
test("V2 resumes three exact parts after offline and reload without reallocating", async ({
  page,
  context,
}, info) => {
  const api = "http://127.0.0.1:3001",
    provider = "http://127.0.0.1:3012";
  const stats = async () => (await page.request.get(`${provider}/stats`)).json();
  expect((await page.request.post(`${provider}/control`, { data: { reset: true } })).ok()).toBe(
    true,
  );
  expect(
    (
      await page.request.post(`${api}/auth/register`, {
        headers: { origin: "http://127.0.0.1:3000" },
        data: {
          name: "V2 recovery owner",
          email: `v2-${Date.now()}@e2e.ayin.test`,
          password: "strong-pass-123",
        },
      })
    ).ok(),
  ).toBe(true);
  const region = page.getByRole("region", { name: "Recoverable uploads", exact: true });
  const button = (name: string) => region.getByRole("button", { name, exact: true });
  const reopen = async () => {
    await page.getByText("Resume an earlier upload", { exact: true }).click();
    await region.locator("summary").click();
    await button("Check saved upload").click();
    await expect(button("Check saved upload")).toBeEnabled();
  };
  await page.goto("/upload?lang=en");
  await reopen();
  await expect(region.getByText("Maximum recoverable file size: 16 MB")).toBeVisible();
  const bytes = Buffer.alloc(10 * 1024 ** 2 + 137);
  for (let n = 0; n < bytes.length; n++) bytes[n] = (n * 31 + (n >>> 8) + 17) & 255;
  const file = { name: "v2-offline.mp4", mimeType: "video/mp4", buffer: bytes };
  const choose = async () => {
    await region.getByLabel("Choose original video", { exact: true }).setInputFiles(file);
    await expect(button("Check saved upload")).toBeEnabled();
    await expect(region.getByText(file.name, { exact: true })).toBeVisible();
  };
  await choose();
  await button("Save draft").click();
  await expect(button("Check saved upload")).toBeEnabled();
  await button("Check saved upload").click();
  await expect(button("Continue upload")).toBeEnabled();
  let held = false,
    release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/media/uploads/sessions/*/inspection", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    if (
      !held &&
      snapshot.observation?.kind === "PARTS_OBSERVED" &&
      snapshot.observation.parts.length === 1
    ) {
      held = true;
      await barrier;
      await route.abort("internetdisconnected").catch(() => undefined);
    } else await route.fulfill({ response });
  });
  await button("Continue upload").click();
  await expect.poll(() => held).toBe(true);
  await context.setOffline(true);
  release();
  await expect(button("Check saved upload")).toBeEnabled();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(await stats()).toMatchObject({ allocations: 1, authorizations: 1, puts: 1, completes: 0 });
  await context.setOffline(false);
  await page.unroute("**/media/uploads/sessions/*/inspection");
  await page.reload();
  await reopen();
  await expect(button("Continue upload")).toBeDisabled();
  await choose();
  await button("Check saved upload").click();
  await expect(button("Continue upload")).toBeEnabled();
  await button("Continue upload").click();
  await expect(button("Finish upload")).toBeEnabled();
  await button("Finish upload").click();
  await expect(region.getByText(/Upload accepted. AYIN is checking and preparing/)).toBeVisible();
  const result = await stats();
  expect(result).toMatchObject({
    allocations: 1,
    authorizations: 3,
    puts: 3,
    completes: 1,
    sessions: 1,
    // Recovered sources must verify their full-file identity before processing.
    queued: 1,
    processingQueued: 0,
    published: 0,
  });
  expect(result.received.map((item: { bytes: number }) => item.bytes)).toEqual([
    5 * 1024 ** 2,
    5 * 1024 ** 2,
    137,
  ]);
  for (const received of result.received)
    expect(received).toMatchObject({ cookiePresent: false, authorizationPresent: false });
  expect(result.storedObjects).toEqual([
    {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentType: "video/mp4",
    },
  ]);
  await info.attach("v2-offline-multipart-result", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("v2-offline-multipart.png") });
});
