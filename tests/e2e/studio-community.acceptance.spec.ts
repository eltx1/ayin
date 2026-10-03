import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const headers = { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" };
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "http://invalid",
  );
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("ayin_e2e"))
    throw new Error("Community acceptance requires the isolated local ayin_e2e database");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: { name: "Community creator", email, password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBe(true);
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}
test("creator community paginates actual owned posts and preserves drafts through confirmation in EN/AR", async ({
  page,
}, testInfo) => {
  test.setTimeout(150000);
  expect((await page.request.get(`${API}/creator/community/posts/page`)).status()).toBe(401);
  await register(page, "studio-community-pages@e2e.ayin.test");
  for (let i = 0; i < 32; i++) {
    const response = await page.request.post(`${API}/creator/community/posts`, {
      data: { type: "TEXT", body: `Actual draft ${i}` },
      headers: { origin: WEB },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto("/studio/community?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("article")).toHaveCount(30);
  await main.getByRole("button", { name: "Load more posts", exact: true }).click();
  await expect(main.getByRole("article")).toHaveCount(32);
  await expect(main.getByRole("button", { name: "Load more posts", exact: true })).toHaveCount(0);
  const draft = main.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Keep this unsaved draft");
  await main
    .getByRole("article")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Discard these changes?");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(draft).toHaveValue("Keep this unsaved draft");
  await main.getByRole("button", { name: "New post", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  await expect(draft).toHaveValue("");
  const article = main.getByRole("article").first();
  const body = await article.locator("p[dir=auto]").textContent();
  await article.getByRole("button", { name: "Publish now", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(body!);
  await page.getByRole("dialog").getByRole("button", { name: "Publish now", exact: true }).click();
  await expect(main.getByText("Post published.", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("article").filter({ hasText: body! }).getByText("Published", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-studio-community-390-en.png"),
    fullPage: true,
  });
  await page.goto("/ar/studio/community?lang=ar");
  await expect(main.getByRole("heading", { level: 1, name: "المجتمع", exact: true })).toBeVisible();
  await expect(main.getByRole("article")).toHaveCount(30);
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-studio-community-390-ar.png"),
    fullPage: true,
  });
});
test("committed response loss retains the draft, requires review and never replays create", async ({
  page,
}) => {
  await register(page, "studio-community-loss@e2e.ayin.test");
  let writes = 0;
  await page.route(`${API}/creator/community/posts`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await page.goto("/studio/community?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByText("No community posts yet.", { exact: true })).toBeVisible();
  const draft = main.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Response-loss draft");
  await main.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(main.getByText(/We could not confirm the result/)).toBeVisible();
  await expect(draft).toHaveValue("Response-loss draft");
  await expect(main.getByRole("button", { name: "Create draft", exact: true })).toBeDisabled();
  await expect(main.getByRole("button", { name: "New post", exact: true })).toBeDisabled();
  await main.getByRole("button", { name: "Refresh posts", exact: true }).click();
  await expect(main.getByRole("article")).toHaveCount(1);
  expect(writes).toBe(1);
  await main.getByRole("article").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  await draft.fill("Reviewed existing draft");
  await main.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(main.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  expect(
    (await (await page.request.get(`${API}/creator/community/posts/page`)).json()).items,
  ).toHaveLength(1);
});
test("known saved writes are distinct from failed reads and invalid images create no orphan post", async ({
  page,
}) => {
  await register(page, "studio-community-readfail@e2e.ayin.test");
  let failRead = false,
    writes = 0;
  await page.route(`${API}/creator/community/posts/page?*`, async (route) => {
    if (failRead)
      return route.fulfill({ status: 503, headers, json: { error: { code: "UNAVAILABLE" } } });
    return route.continue();
  });
  await page.route(`${API}/creator/community/posts`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    failRead = true;
    await route.fulfill({ response });
  });
  await page.goto("/studio/community?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByText("No community posts yet.", { exact: true })).toBeVisible();
  await main.getByRole("combobox", { name: "Post type", exact: true }).selectOption("IMAGE");
  await main.getByRole("textbox", { name: "Message", exact: true }).fill("Invalid image draft");
  await main.getByLabel("Image", { exact: true }).setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await main.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(
    main.getByText("Choose a valid JPG, PNG or WebP image up to 10 MB.", { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await main.getByRole("combobox", { name: "Post type", exact: true }).selectOption("TEXT");
  await main.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(main.getByText(/Your change was saved, but the updated list/)).toBeVisible();
  await expect(main.getByText(/We could not confirm the result/)).toHaveCount(0);
  expect(writes).toBe(1);
  failRead = false;
  await main.getByRole("button", { name: "Refresh posts", exact: true }).click();
  await expect(main.getByRole("article")).toHaveCount(1);
  await expect(main.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
});

test("acknowledged image roots keep their identity through upload failure and retry", async ({
  page,
}) => {
  await register(page, "studio-community-imagepartial@e2e.ayin.test");
  let creates = 0,
    patches = 0,
    authorizations = 0;
  await page.route(`${API}/creator/community/posts`, async (route) => {
    if (route.request().method() === "POST") creates++;
    await route.continue();
  });
  await page.route(`${API}/creator/community/posts/*`, async (route) => {
    if (route.request().method() === "PATCH") patches++;
    await route.continue();
  });
  await page.route(`${API}/creator/community/posts/*/image/authorize`, async (route) => {
    authorizations++;
    if (authorizations === 1) return route.abort("failed");
    return route.fulfill({
      status: 503,
      headers,
      json: { error: { code: "STORAGE_UNAVAILABLE" } },
    });
  });
  await page.goto("/studio/community?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByText("No community posts yet.", { exact: true })).toBeVisible();
  await main.getByRole("combobox", { name: "Post type", exact: true }).selectOption("IMAGE");
  await main
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep the known image root");
  await main.getByLabel("Image", { exact: true }).setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNIET0HAAIoAUh9ho5VAAAAAElFTkSuQmCC",
      "base64",
    ),
  });
  await main.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(main.getByText(/The post draft was saved, but the image upload/)).toBeVisible();
  await expect(main.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep the known image root",
  );
  await expect(main.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await main.getByRole("button", { name: "Refresh posts", exact: true }).click();
  await expect(main.getByRole("article")).toHaveCount(1);
  await main.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => authorizations).toBe(2);
  await expect(main.getByText(/The post draft was saved, but the image upload/)).toBeVisible();
  expect(creates).toBe(1);
  expect(patches).toBe(1);
  const saved = await (await page.request.get(`${API}/creator/community/posts/page`)).json();
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0].type).toBe("IMAGE");
});
