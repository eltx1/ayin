import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const headers = { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" };
// These tests inject response loss and gated writes. Production/PWA tests retain workers.
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});

async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: { name: "Feedback creator", email, password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBe(true);
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}

test("recent comment tables distinguish errors, empty results and filtered snapshots in EN/AR", async ({
  page,
}, testInfo) => {
  expect((await page.request.get(`${API}/creator/studio/comments`)).status()).toBe(401);
  await register(page, "feedback-comments@e2e.ayin.test");
  const own = await page.request.get(`${API}/creator/studio/comments`);
  expect(own.ok()).toBe(true);
  expect((await own.json()).comments).toEqual([]);
  // Explicit UI fixtures, not evidence of real engagement or comment authorization.
  const comments = [
    {
      id: "fixture-one",
      body: "A careful observation " + "longword".repeat(35),
      status: "PUBLISHED",
      createdAt: "2026-01-01T12:00:00Z",
      parentId: null,
      authorProfile: { id: "reader-one", name: "أحمد", slug: "ahmed" },
      video: { id: "video-one", title: "Quiet Sea", commentsEnabled: true },
      _count: { reactions: 0, replies: 1, reports: 0 },
    },
    {
      id: "fixture-two",
      body: "تفاصيل رائعة <script>not executable</script>",
      status: "HIDDEN",
      createdAt: "2026-01-02T12:00:00Z",
      parentId: null,
      authorProfile: { id: "reader-two", name: "Alice", slug: "alice" },
      video: { id: "video-two", title: "المدينة", commentsEnabled: false },
      _count: { reactions: 2, replies: 0, reports: 1 },
    },
  ];
  let mode: "error" | "empty" | "ready" = "error";
  let reads = 0;
  await page.route(`${API}/creator/studio/comments`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    reads++;
    await route.fulfill({
      status: mode === "error" ? 503 : 200,
      headers,
      json:
        mode === "error"
          ? { message: "Unavailable" }
          : { channel: {}, comments: mode === "empty" ? [] : comments },
    });
  });
  await page.goto("/studio/comments?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("could not be loaded");
  await expect(main.getByText("No comments yet.", { exact: true })).toHaveCount(0);
  mode = "empty";
  await main.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(main.getByText("No comments yet.", { exact: true })).toBeVisible();
  await expect(main.getByRole("table")).toHaveCount(0);
  mode = "ready";
  await main.getByRole("button", { name: "Refresh", exact: true }).click();
  const table = main.getByRole("table", { name: "Recent comments across your videos" });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.locator('th[scope="col"]')).toHaveCount(3);
  await expect(table.getByRole("rowheader")).toHaveCount(2);
  const prior = reads;
  await main.getByLabel("Search recent comments", { exact: true }).fill("أحمد");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await main.getByLabel("Visibility", { exact: true }).selectOption("HIDDEN");
  await expect(
    main.getByText("No recent comments match these filters.", { exact: true }),
  ).toBeVisible();
  await expect(main.getByText("No comments yet.", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  expect(reads).toBe(prior);
  await expect(table.locator("script")).toHaveCount(0);
  await main.getByText("Read full comment", { exact: true }).click();
  await expect(table.locator("details[open]")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const region = main.getByRole("region", { name: "Recent comments across your videos" });
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => region.evaluate((element) => Math.abs(element.scrollLeft)))
    .toBeGreaterThan(0);
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-feedback-comments-390-en.png"),
    fullPage: true,
  });
  await page.goto("/ar/studio/comments?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    main.getByRole("heading", { level: 1, name: "التعليقات", exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await main.getByLabel("ابحث في التعليقات الحديثة", { exact: true }).fill("المدينة");
  await expect(main.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(main.getByRole("table").getByText("مخفي", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-feedback-comments-390-ar.png"),
    fullPage: true,
  });
});

test("support submits once, preserves uncertain drafts and separates write success from refresh failure", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  expect((await page.request.get(`${API}/support/tickets`)).status()).toBe(401);
  await register(page, "feedback-support@e2e.ayin.test");
  let readFails = true;
  let writeFails = false;
  let writes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API}/support/tickets`, async (route) => {
    const method = route.request().method();
    if (method === "GET" && readFails)
      return route.fulfill({ status: 503, headers, json: { message: "Unavailable" } });
    if (method === "POST") {
      writes++;
      if (writeFails) return route.abort("failed");
      await gate;
    }
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio/support?lang=en");
  const main = page.getByRole("main");
  const tickets = main.getByRole("region", { name: "My tickets", exact: true });
  const form = main.getByRole("form", { name: "Open a ticket", exact: true });
  await expect(tickets.getByRole("alert")).toContainText("could not be loaded");
  await expect(tickets.getByText("No support tickets yet.", { exact: true })).toHaveCount(0);
  readFails = false;
  await tickets.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(tickets.getByText("No support tickets yet.", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Priority", { exact: true })).not.toBeVisible();
  await form.getByLabel("Subject", { exact: true }).fill("A real support request");
  await form.getByLabel("Details", { exact: true }).fill("The video upload needs a careful look.");
  await form.getByRole("button", { name: "Create ticket", exact: true }).click();
  try {
    await expect.poll(() => writes).toBe(1);
    await expect(form.getByLabel("Subject", { exact: true })).toBeDisabled();
    await expect(form.getByLabel("Details", { exact: true })).toBeDisabled();
    await form.evaluate((element) =>
      element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(writes).toBe(1);
    readFails = true;
  } finally {
    release();
  }
  await expect(form.getByRole("status")).toContainText("Your support ticket was sent.");
  await expect(form.getByLabel("Subject", { exact: true })).toHaveValue("");
  await expect(tickets.getByRole("alert")).toContainText("could not be loaded");
  const stored = await page.request.get(`${API}/support/tickets`);
  expect(stored.ok()).toBe(true);
  const created = (await stored.json()).items;
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    subject: "A real support request",
    priority: "NORMAL",
    status: "OPEN",
  });
  readFails = false;
  await tickets.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(tickets.getByText("A real support request", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await tickets.getByText("A real support request", { exact: true }).click();
  await expect(
    tickets.getByText("The video upload needs a careful look.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("design-feedback-support-1440-en.png"),
    fullPage: true,
  });
  writeFails = true;
  await form.getByLabel("Subject", { exact: true }).fill("Preserve this support draft");
  await form
    .getByLabel("Details", { exact: true })
    .fill("Keep these exact details after a lost response.");
  await form.getByText("Additional options", { exact: true }).click();
  await form.getByLabel("Priority", { exact: true }).selectOption("HIGH");
  await form.getByRole("button", { name: "Create ticket", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(
    "could not confirm whether your ticket was sent",
  );
  await expect(form.getByLabel("Subject", { exact: true })).toHaveValue(
    "Preserve this support draft",
  );
  await expect(form.getByLabel("Details", { exact: true })).toHaveValue(
    "Keep these exact details after a lost response.",
  );
  await expect(form.getByLabel("Priority", { exact: true })).toHaveValue("HIGH");
  await tickets.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(tickets.getByText("A real support request", { exact: true })).toBeVisible();
  expect(writes).toBe(2);
  const other = await browser.newContext();
  try {
    const response = await other.request.post(`${API}/auth/register`, {
      data: {
        name: "Other creator",
        email: "feedback-other@e2e.ayin.test",
        password: "strong-pass-123",
      },
      headers: { origin: WEB },
    });
    expect(response.ok()).toBe(true);
    const own = await other.request.get(`${API}/support/tickets`);
    expect(own.status()).toBe(200);
    expect(
      (await own.json()).items.some((ticket: { id: string }) => ticket.id === created[0].id),
    ).toBe(false);
  } finally {
    await other.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/studio/support?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByRole("heading", { level: 1, name: "الدعم", exact: true })).toBeVisible();
  await expect(main.getByText("مفتوحة", { exact: true })).toBeVisible();
  await main.getByLabel("الموضوع", { exact: true }).fill("طلب مساعدة جديد");
  await main
    .getByLabel("التفاصيل", { exact: true })
    .fill("هذه تفاصيل محفوظة لاختبار العرض على الهاتف.");
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-feedback-support-390-ar.png"),
    fullPage: true,
  });
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(writes).toBe(2);
});
