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
      const pages: { hrefs: string[]; nextCursor: string | null }[] = [];
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
        pages.push({
          hrefs: result.items.map((item: { href: string }) => `${prefix}${item.href}`),
          nextCursor: result.nextCursor,
        });
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
      expect(pages.length).toBeGreaterThan(1);
      expect(lastCursor).toBeTruthy();
      await page.setViewportSize(layout);
      await page.goto(`${prefix}/search?q=${encodeURIComponent(query)}&lang=${layout.locale}`);
      const main = page.locator("main:visible");
      const results = main.getByRole("region", {
        name: ar ? `نتائج البحث عن ${query}` : `Search results for ${query}`,
        exact: true,
      });
      // Autocomplete links are independent of the paginated result cards.
      const cards = results.locator(
        'a[href*="/movies/catalog-journey-"], a[href*="/series/catalog-series-"]',
      );
      const cardHrefs = () =>
        cards.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      await expect(cards.first()).toContainText(ar ? "رحلة" : "Journey");
      await expect.poll(cardHrefs).toEqual(pages[0]!.hrefs);
      const searchbox = main.getByRole("searchbox");
      await expect(searchbox).toHaveValue(query);
      const suggestions = main.getByRole("list", {
        name: ar ? "اقتراحات البحث" : "Search suggestions",
        exact: true,
      });
      // Initial results are unobscured, even after the debounce interval.
      await page.waitForTimeout(350);
      await expect(suggestions).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`global-search-initial-${layout.width}-${layout.locale}.png`),
      });
      const suggestionsResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/public/search/suggestions" &&
          url.searchParams.get("q") === query
        );
      });
      await searchbox.focus();
      const suggestionResponse = await suggestionsResponse;
      expect(suggestionResponse.ok()).toBe(true);
      // Chromium may discard the body handle when the component supersedes its
      // request. Retain the observed successful component request and verify the
      // rendered order against the same URL in the same authenticated context.
      const expectedSuggestions = await page.request.get(suggestionResponse.url(), {
        headers: { "x-ayin-locale": layout.locale },
      });
      expect(expectedSuggestions.ok()).toBe(true);
      const suggestionData = await expectedSuggestions.json();
      await expect(suggestions).toBeVisible();
      await expect
        .poll(() =>
          suggestions
            .getByRole("link")
            .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
        )
        .toEqual(
          suggestionData.suggestions.map((item: { href: string }) => `${prefix}${item.href}`),
        );
      await expect.poll(cardHrefs).toEqual(pages[0]!.hrefs);
      await page.keyboard.press("ArrowDown");
      await expect(suggestions.getByRole("link").first()).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`global-search-suggestions-${layout.width}-${layout.locale}.png`),
      });
      await page.keyboard.press("ArrowUp");
      await expect(searchbox).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(suggestions).toHaveCount(0);
      await expect(searchbox).toBeFocused();
      await expect.poll(cardHrefs).toEqual(pages[0]!.hrefs);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`global-search-${layout.width}-${layout.locale}.png`),
      });
      const firstPageUrl = page.url();
      const more = results.getByRole("link", {
        name: ar ? "مزيد من النتائج" : "More results",
        exact: true,
      });
      const secondPageUrl = new URL((await more.getAttribute("href"))!, firstPageUrl).href;
      expect(new URL(secondPageUrl).searchParams.get("cursor")).toBe(pages[0]!.nextCursor);
      await more.focus();
      await expect(more).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(secondPageUrl);
      await expect.poll(cardHrefs).toEqual(pages[1]!.hrefs);
      await expect(suggestions).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(firstPageUrl);
      await expect.poll(cardHrefs).toEqual(pages[0]!.hrefs);
      await expect(suggestions).toHaveCount(0);
      await page.goForward();
      await expect(page).toHaveURL(secondPageUrl);
      await expect.poll(cardHrefs).toEqual(pages[1]!.hrefs);
      await expect(suggestions).toHaveCount(0);
      await page.goto(`${prefix}/search?${new URLSearchParams({ q: query, cursor: lastCursor! })}`);
      await expect.poll(cardHrefs).toEqual(pages.at(-1)!.hrefs);
      await expect(more).toHaveCount(0);
    }
  } finally {
    fixture("cleanup", data);
  }
});
