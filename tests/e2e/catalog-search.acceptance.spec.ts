import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
function fixture(command: string, payload: object = {}): object {
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

test("global catalog search presents EN/AR copy and traverses its stable bounded window", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const data = fixture("seed");
  try {
    for (const layout of layouts) {
      const ar = layout.locale === "ar";
      const prefix = ar ? "/ar" : "";
      const query = ar ? "رحلة" : "Journey";
      const movieIds = new Set<string>();
      const allIds = new Set<string>();
      let cursor: string | undefined;
      let lastCursor: string | undefined;
      do {
        lastCursor = cursor;
        const params = new URLSearchParams({
          q: query,
          limit: "12",
          ...(cursor ? { cursor } : {}),
        });
        const response = await page.request.get(`${API}/public/search?${params}`, {
          headers: { "x-ayin-locale": layout.locale },
        });
        expect(response.ok()).toBe(true);
        expect(response.headers()["cache-control"]).toBe("private, no-store");
        const result = await response.json();
        for (const item of result.items) {
          const key = `${item.type}:${item.id}`;
          expect(allIds.has(key)).toBe(false);
          allIds.add(key);
          if (item.type === "MOVIE") {
            movieIds.add(item.id);
            expect(item.title).toMatch(ar ? /^رحلة / : /^Journey /);
          }
        }
        cursor = result.nextCursor ?? undefined;
        expect(allIds.size).toBeLessThanOrEqual(111);
      } while (cursor);
      expect(movieIds.size).toBe(110);
      expect(lastCursor).toBeTruthy();
      await page.setViewportSize(layout);
      await page.goto(`${prefix}/search?q=${encodeURIComponent(query)}&lang=${layout.locale}`);
      const main = page.locator("main:visible");
      const cards = main.locator('a[href*="/movies/catalog-journey-"]');
      await expect(cards.first()).toContainText(ar ? "رحلة" : "Journey");
      await expect(main.getByRole("searchbox")).toHaveValue(query);
      for (const href of await cards.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")),
      ))
        expect(href).toMatch(new RegExp(`^${prefix}/movies/`));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`global-search-${layout.width}-${layout.locale}.png`),
      });
      const previousFirst = await cards.first().getAttribute("href");
      const more = main.locator('a[href*="cursor="]');
      await more.focus();
      await page.keyboard.press("Enter");
      await expect(cards.first()).not.toHaveAttribute("href", previousFirst!);
      await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(query);
      await page.goBack();
      await expect(cards.first()).toHaveAttribute("href", previousFirst!);
      await page.goForward();
      await expect(cards.first()).not.toHaveAttribute("href", previousFirst!);
      await page.goto(`${prefix}/search?${new URLSearchParams({ q: query, cursor: lastCursor! })}`);
      await expect(cards.first()).toBeVisible();
      await expect(main.locator('a[href*="cursor="]')).toHaveCount(0);
    }
  } finally {
    fixture("cleanup", data);
  }
});
