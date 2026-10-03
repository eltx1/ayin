import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
for (const locale of ["en", "ar"] as const)
  test(`Upload history reviews every actual source row with manual DB pages and retained filters ${locale}`, async ({
    page,
  }, testInfo) => {
    const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
    const response = await page.request.post(`${API}/auth/register`, {
      headers: { origin: WEB },
      data: {
        name: "Actual Upload History Owner",
        email: `history-${locale}@e2e.ayin.test`,
        password: "strong-pass-123",
      },
    });
    expect(response.ok()).toBe(true);
    const user = (await response.json()).user;
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/upload-history-fixture.mjs"),
        JSON.stringify({ accountId: user.account.id }),
      ],
      { env: process.env },
    );
    let reads = 0,
      writes = 0;
    page.on("request", (request) => {
      if (request.url().startsWith(`${API}/creator/videos/uploads`)) reads++;
      if (
        (request.url().startsWith(`${API}/creator/videos`) ||
          request.url().startsWith(`${API}/media/uploads`)) &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
      )
        writes++;
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/upload?lang=${locale}`);
    const history = page.getByRole("region", {
      name: copy("Saved upload history", "سجل الرفع المحفوظ"),
      exact: true,
    });
    await expect(history.getByRole("heading", { level: 2 })).toHaveText(
      copy("Saved upload history", "سجل الرفع المحفوظ"),
    );
    expect(reads).toBe(0);
    const summary = history.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await history
      .getByRole("button", {
        name: copy("Read saved uploads", "قراءة ملفات الرفع المحفوظة"),
        exact: true,
      })
      .click();
    await expect(history.locator("article")).toHaveCount(25);
    const pages = history.getByRole("navigation", {
      name: copy("Upload history pages", "صفحات سجل الرفع"),
    });
    await pages.getByRole("button", { name: copy("Next", "التالي"), exact: true }).click();
    await expect(history.locator("article")).toHaveCount(1);
    expect(reads).toBe(2);
    expect(writes).toBe(0);
    // Full-page captures at a retained scroll offset paint fixed/sticky chrome
    // over unrelated document rows. Verify the actual visible controls instead.
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const heading = history.getByRole("heading", { level: 2 });
      await heading.evaluate((element) => {
        window.scrollTo({ top: element.getBoundingClientRect().top + scrollY - 100 });
      });
      await expect
        .poll(async () => {
          const bounds = await heading.boundingBox();
          return bounds !== null && bounds.y >= 80 && bounds.y + bounds.height < 300;
        })
        .toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: testInfo.outputPath(`design-upload-history-${locale}-${width}.png`),
      });
      const previous = pages.getByRole("button", {
        name: copy("Previous", "السابق"),
        exact: true,
      });
      if (width === 390)
        await previous.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await expect(previous).toBeEnabled();
      await expect
        .poll(async () =>
          previous.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const chrome = [...document.querySelectorAll("header, nav")]
              .filter((node) => ["fixed", "sticky"].includes(getComputedStyle(node).position))
              .map((node) => node.getBoundingClientRect())
              .filter((rect) => rect.width > 0 && rect.height > 0);
            return (
              bounds.top >= 0 &&
              bounds.bottom <= innerHeight &&
              chrome.every(
                (rect) =>
                  bounds.bottom <= rect.top ||
                  bounds.top >= rect.bottom ||
                  bounds.right <= rect.left ||
                  bounds.left >= rect.right,
              )
            );
          }),
        )
        .toBe(true);
      if (width === 390) {
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await page.screenshot({
          path: testInfo.outputPath(`design-upload-history-${locale}-${width}-pager.png`),
        });
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await history.getByLabel(copy("Video status", "حالة الفيديو")).selectOption("DRAFT");
    await history
      .getByRole("button", {
        name: copy("Read saved uploads", "قراءة ملفات الرفع المحفوظة"),
        exact: true,
      })
      .click();
    await expect(history.locator("article")).toHaveCount(1);
    await expect(history.locator("article")).toContainText(copy("Draft", "مسودة"));
    await page.route("**/creator/videos/uploads?**", (route) =>
      route.fulfill({ status: 503, json: { message: "Controlled history read unavailable" } }),
    );
    await history
      .getByRole("button", {
        name: copy("Read saved uploads", "قراءة ملفات الرفع المحفوظة"),
        exact: true,
      })
      .click();
    await expect(
      history.getByText(copy("Upload history unavailable", "سجل الرفع غير متاح"), { exact: true }),
    ).toBeVisible();
    await expect(history.locator("article")).toHaveCount(0);
    await expect(history.getByLabel(copy("Video status", "حالة الفيديو"))).toHaveValue("DRAFT");
    expect(writes).toBe(0);
  });
