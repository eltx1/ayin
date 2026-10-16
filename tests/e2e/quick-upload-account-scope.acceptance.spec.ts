import { expect, test, type Route } from "@playwright/test";
const API = "http://127.0.0.1:3001";
test.use({ serviceWorkers: "block" });

// Actual shared ViewerProduct + QuickUpload components; API identities and
// storage transfer are synthetic. This does not prove production logout/R2.
test("standard upload conceals and aborts on suspension, then resets for another account", async ({
  page,
}) => {
  const identity = (digit: string) => ({
    account: {
      id: `${digit.repeat(8)}-1111-4111-8111-111111111111`,
      displayName: `Creator ${digit}`,
      email: `creator-${digit}@e2e.ayin.test`,
    },
    channel: {
      id: `${digit.repeat(8)}-2222-4222-8222-222222222222`,
      name: `Channel ${digit}`,
      handle: `creator-${digit}`,
    },
    profile: {
      id: `${digit.repeat(8)}-3333-4333-8333-333333333333`,
      name: `Profile ${digit}`,
      slug: `profile-${digit}`,
    },
    creatorTv: {
      id: `${digit.repeat(8)}-4444-4444-8444-444444444444`,
      name: `TV ${digit}`,
      slug: `tv-${digit}`,
    },
  });
  let owner: ReturnType<typeof identity> | null = identity("1");
  let put: Route | undefined;
  let failedPut = false;
  let completions = 0;
  page.on("requestfailed", (request) => {
    if (request.url() === "https://e2e-upload.invalid/scope-test") failedPut = true;
  });
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/me")
      return route.fulfill({ status: owner ? 200 : 401, json: owner ?? {} });
    if (url.pathname === "/platform/navigation") return route.fulfill({ json: {} });
    if (url.pathname === "/product-controls")
      return route.fulfill({
        json: {
          navigation: [],
          deviceVisibility: { web: true, mobile: true, tv: true },
          announcement: { enabled: false, text: "", href: null },
          resolvedHero: null,
        },
      });
    if (url.pathname === "/creator/videos/drafts")
      return route.fulfill({
        json: {
          video: {
            id: "55555555-5555-4555-8555-555555555555",
            channelId: owner!.channel.id,
            title: "Private camera source",
            status: "UPLOADING",
            visibility: "PUBLIC",
            commentsEnabled: true,
            durationMs: null,
            videoForm: "LONG_FORM",
          },
          uploadSession: {
            assetId: "66666666-6666-4666-8666-666666666666",
            sessionToken: "synthetic-test-only",
            mode: "single",
            upload: { url: "https://e2e-upload.invalid/scope-test", method: "PUT", headers: {} },
          },
        },
      });
    if (url.pathname.includes("complete")) completions++;
    return route.fulfill({ status: 404, json: { error: { code: "SYNTHETIC_UNAVAILABLE" } } });
  });
  await page.route("https://e2e-upload.invalid/scope-test", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "http://127.0.0.1:3000",
          "access-control-allow-methods": "PUT,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    put = route;
  });
  await page.goto("/upload?lang=en");
  const picker = page.locator('input[type="file"][accept^="video/"]');
  await expect
    .poll(() =>
      picker.evaluateAll((nodes) => nodes.length === 1 && !(nodes[0] as HTMLInputElement).disabled),
    )
    .toBe(true);
  await expect(picker).toHaveCount(1);
  await expect(picker).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await picker.setInputFiles({
    name: "private-camera-source.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(1024),
  });
  expect(put).toBeUndefined();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => Boolean(put)).toBe(true);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "private camera source",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("[data-private-creator-upload]")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Upload a video", exact: true })).toBeVisible();
  await expect.poll(() => failedPut).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "private camera source",
  );
  await expect(
    page.getByText(
      "Upload could not be confirmed. Review your saved uploads in Studio before starting again.",
    ),
  ).toBeVisible();
  await expect(picker).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  owner = identity("2");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(picker).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
  expect(await picker.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
  owner = null;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    page.getByRole("link", { name: "Sign in to upload a video", exact: true }),
  ).toBeVisible();
  await expect(picker).toHaveCount(1);
  await expect(picker).toBeHidden();
  expect(await picker.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
  expect(completions).toBe(0);
  await put?.abort().catch(() => undefined);
});
