import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "http://invalid",
  );
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("ayin_e2e"))
    throw new Error("Upload acceptance requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
for (const mismatched of [false, true]) {
  test(`real prepared upload ${mismatched ? "rejects a mismatched completion without replay" : "uses validated storage and acknowledged completion"}`, async ({
    page,
  }) => {
    const registration = await page.request.post(`${API}/auth/register`, {
      headers: { origin: WEB },
      data: {
        name: "Upload transport creator",
        email: "upload-transport@e2e.ayin.test",
        password: "strong-pass-123",
      },
    });
    expect(registration.ok()).toBe(true);
    let drafts = 0,
      completions = 0,
      confirmations = 0,
      puts = 0;
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.url().endsWith("/creator/videos/drafts")) drafts++;
      if (request.url().endsWith("/media/uploads/sessions/complete")) completions++;
      if (request.url().endsWith("/upload-complete")) confirmations++;
    });
    await page.route("https://e2e-upload.invalid/**", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        puts++;
        expect(request.headers()["cookie"]).toBeUndefined();
      }
      await route.fulfill({
        status: request.method() === "OPTIONS" ? 204 : 200,
        body: "",
        headers: {
          "access-control-allow-origin": WEB,
          "access-control-allow-methods": "PUT,OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-expose-headers": "etag",
          etag: '"e2e-object"',
        },
      });
    });
    if (mismatched)
      await page.route(`${API}/media/uploads/sessions/complete`, async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const body = await response.json();
        expect(body.status).toBe("UPLOADED");
        await route.fulfill({
          response,
          json: { ...body, assetId: "22222222-2222-4222-8222-222222222222" },
        });
      });
    await page.goto("/upload?lang=en");
    const picker = page.locator('input[type="file"][accept^="video/"]');
    await expect
      .poll(() =>
        picker.evaluateAll(
          (nodes) => nodes.length === 1 && !(nodes[0] as HTMLInputElement).disabled,
        ),
      )
      .toBe(true);
    await expect(picker).toHaveCount(1);
    await expect(picker).toBeEnabled();
    await picker.setInputFiles({
      name: "transport.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(1024),
    });
    const progress = page.getByRole("progressbar", { name: "Upload progress", exact: true });
    if (mismatched) {
      await expect(page.getByText(/The upload response could not be verified/)).toBeVisible();
      await expect(progress).toHaveAttribute("aria-valuenow", "99");
      expect(confirmations).toBe(0);
      await expect(page.getByRole("button", { name: "Publish video", exact: true })).toBeDisabled();
    } else {
      await expect(progress).toHaveAttribute("aria-valuenow", "100");
      await expect.poll(() => confirmations).toBe(1);
    }
    expect(drafts).toBe(1);
    expect(completions).toBe(1);
    expect(puts).toBe(1);
    // No replay action is taken; settled UI must not issue another root/write.
    await page.getByRole("heading", { name: "Finish your video", exact: true }).click();
    expect(drafts).toBe(1);
    expect(completions).toBe(1);
  });
}
