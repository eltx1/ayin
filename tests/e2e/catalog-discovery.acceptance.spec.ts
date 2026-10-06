import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

interface CatalogFixture {
  movieIds: string[];
  channelId: string;
  seriesId: string;
  seriesSlug: string;
  firstSlug: string;
  nextSlug: string;
  nextVideoId: string;
}
function fixture<T = CatalogFixture>(command: string, payload: object = {}): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/catalog-discovery-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
const layouts = [
  { width: 1440, height: 1000, locale: "en" },
  { width: 390, height: 844, locale: "en" },
  { width: 1440, height: 1000, locale: "ar" },
  { width: 390, height: 844, locale: "ar" },
] as const;
test.use({ serviceWorkers: "block" });

test("localized catalog search traverses 110 real records and Watch advances explicitly through eligible episodes", async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  const data = fixture("seed");
  // Catalog/API/navigation are real. This slice does not certify media delivery.
  await page.route("**/media/catalog-browser/**", (route) => route.abort());
  try {
    for (const layout of layouts) {
      await page.setViewportSize(layout);
      const ar = layout.locale === "ar";
      const prefix = ar ? "/ar" : "";
      const q = ar ? "رحلة" : "Journey";
      await page.goto(`${prefix}/movies?lang=${layout.locale}`);
      const main = page.locator("main:visible");
      const search = main.getByRole("searchbox", {
        name: ar ? "ابحث في الأفلام" : "Search movies",
        exact: true,
      });
      await search.fill(q);
      await search.press("Enter");
      await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(q);
      const seen = new Set<string>();
      const firstPageUrl = page.url();
      for (let number = 0; number < 5; number++) {
        const cards = main.locator('ul a[href*="/movies/catalog-journey-"]');
        await expect(cards).toHaveCount(number === 4 ? 14 : 24);
        for (const href of await cards.evaluateAll((links) =>
          links.map((link) => link.getAttribute("href")!),
        )) {
          expect(seen.has(href)).toBe(false);
          seen.add(href);
        }
        if (number === 0) {
          await page.screenshot({
            path: testInfo.outputPath(`catalog-search-${layout.width}-${layout.locale}.png`),
          });
        }
        const more = main.getByRole("link", {
          name: ar ? "تصفّح المزيد" : "Browse more",
          exact: true,
        });
        if (number < 4) {
          const previousFirst = await cards.first().getAttribute("href");
          await more.click();
          await expect(cards.first()).not.toHaveAttribute("href", previousFirst!);
          await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(q);
          await expect.poll(() => new URL(page.url()).searchParams.get("cursor")).not.toBeNull();
        } else await expect(more).toHaveCount(0);
      }
      expect(seen.size).toBe(110);
      await page.goBack();
      await expect(main.locator('ul a[href*="/movies/catalog-journey-"]')).toHaveCount(24);
      await page.goForward();
      await expect(main.locator('ul a[href*="/movies/catalog-journey-"]')).toHaveCount(14);
      await search.fill("no-such-catalog-title");
      await search.press("Enter");
      await expect(
        main.getByRole("heading", {
          name: ar ? "لا توجد عناوين مطابقة" : "No matching titles",
          exact: true,
        }),
      ).toBeVisible();
      expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
      await main
        .getByRole("link", { name: ar ? "مسح البحث" : "Clear search", exact: true })
        .first()
        .click();
      await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
      await expect(search).toHaveValue("");
      await page.goto(firstPageUrl);
      await expect(search).toHaveValue(q);
      await page.goto(`${prefix}/series?q=${encodeURIComponent(ar ? "الرحلة" : "Journey")}`);
      await main.locator(`a[href="${prefix}/series/${data.seriesSlug}"]`).click();
      await main.locator(`a[href="${prefix}/watch/${data.firstSlug}"]`).first().click();
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        ar ? "الرحلة الأولى" : "First journey",
      );
      const next = main.locator('[data-tv-focus-id="watch-next-episode"]');
      await expect(next).toHaveAttribute("href", `${prefix}/watch/${data.nextSlug}`);
      await expect(next).toContainText(ar ? "الموسم ٢" : "Season 2");
      await next.focus();
      await expect(next).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`catalog-watch-${layout.width}-${layout.locale}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Enter");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        ar ? "العودة" : "The return",
      );
      await expect(main.locator('[data-tv-focus-id="watch-next-episode"]')).toHaveCount(0);
      await expect(
        main.getByText(
          ar ? "تشاهد آخر حلقة متاحة." : "You are watching the last available episode.",
          { exact: true },
        ),
      ).toBeVisible();
      await page.goBack();
      await expect(next).toBeVisible();
    }
    fixture("block-next", data);
    await page.reload();
    await expect(page.locator('main:visible [data-tv-focus-id="watch-next-episode"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator("main:visible").getByText("تشاهد آخر حلقة متاحة.", { exact: true }),
    ).toBeVisible();
  } finally {
    fixture("cleanup", data);
  }
});

test("Watch episode controls stay within unobscured EN/AR viewports", async ({
  page,
}, testInfo) => {
  const data = fixture("seed");
  await page.route("**/media/catalog-browser/**", (route) => route.abort());
  try {
    for (const layout of layouts) {
      await page.setViewportSize(layout);
      const ar = layout.locale === "ar";
      const prefix = ar ? "/ar" : "";
      await page.goto(`${prefix}/watch/${data.firstSlug}?lang=${layout.locale}`);
      const navigation = page
        .locator("main:visible")
        .getByRole("navigation", { name: ar ? "حلقات المسلسل" : "Series episodes", exact: true });
      const next = navigation.locator('[data-tv-focus-id="watch-next-episode"]');
      await expect(next).toBeVisible();
      await navigation.evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      await next.focus();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const readBounds = () =>
        navigation.evaluate((element) => {
          const header = document.querySelector("header");
          const bar = document.querySelector(
            'nav[aria-label="Mobile navigation"], nav[aria-label="التنقل على الهاتف"]',
          );
          const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
          const bottomTop =
            bar && getComputedStyle(bar).display !== "none"
              ? bar.getBoundingClientRect().top
              : innerHeight;
          const controls = [...element.querySelectorAll("a")].map((control) => {
            const rect = control.getBoundingClientRect();
            return {
              text: control.textContent,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              unobscured:
                control.contains(
                  document.elementFromPoint(rect.left + rect.width / 2, rect.top + 2),
                ) &&
                control.contains(
                  document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 2),
                ),
            };
          });
          return {
            headerBottom,
            bottomTop,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            controls,
          };
        });
      await expect
        .poll(async () => {
          const bounds = await readBounds();
          return (
            bounds.controls.length === 2 &&
            bounds.controls.every(
              (control) =>
                control.top >= bounds.headerBottom &&
                control.bottom <= bounds.bottomTop &&
                control.left >= 0 &&
                control.right <= bounds.viewportWidth &&
                control.unobscured,
            )
          );
        })
        .toBe(true);
      await expect(next).toBeFocused();
      const bounds = await readBounds();
      writeFileSync(
        testInfo.outputPath(`catalog-watch-viewport-${layout.width}-${layout.locale}.json`),
        JSON.stringify(bounds, null, 2),
      );
      await page.screenshot({
        path: testInfo.outputPath(`catalog-watch-viewport-${layout.width}-${layout.locale}.png`),
      });
    }
  } finally {
    fixture("cleanup", data);
  }
});
