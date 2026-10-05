import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
type Fixture = { records: Array<{ id: string; name: string; handle: string }> };
function fixture(command: string, payload: object = {}): Fixture {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/media-card-long-content-fixture.mjs"),
        command,
        JSON.stringify(payload),
      ],
      { env: process.env, encoding: "utf8" },
    ),
  ) as Fixture;
}
test.use({ serviceWorkers: "block" });
for (const locale of ["en", "ar"]) {
  test(`Real long creator titles and handles stay within MediaCards in ${locale}`, async ({
    page,
  }, info) => {
    const data = fixture("seed"),
      prefix = locale === "ar" ? "/ar" : "";
    try {
      const response = await page.request.get(
        "http://127.0.0.1:3001/public/discovery/creators?limit=24",
      );
      expect(response.ok()).toBe(true);
      const actual = (await response.json()).items as Array<{
        id: string;
        title: string;
        meta: string;
      }>;
      for (const record of data.records)
        expect(actual.find((item) => item.id === record.id)).toMatchObject({
          title: record.name,
          meta: "@" + record.handle,
        });
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.goto(prefix + "/creators?lang=" + locale);
        const cards = data.records.map((record) =>
          page.getByRole("main").locator(`a[href="${prefix}/c/${record.handle}"]`),
        );
        for (const card of cards) await expect(card).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        ).toBe(true);
        for (const [index, card] of cards.entries()) {
          const record = data.records[index]!;
          await expect(card).toHaveAttribute("aria-label", record.name + ", @" + record.handle);
          await expect(card.locator("strong")).toHaveText(record.name);
          await expect(card).toHaveAttribute("data-tv-focusable", "true");
          const geometry = await card.evaluate((node) => {
            const box = node.getBoundingClientRect(),
              art = node.children[0]!.getBoundingClientRect(),
              copy = node.children[1] as HTMLElement;
            const title = copy.querySelector("strong")!,
              meta = copy.querySelector("span")!,
              titleBox = title.getBoundingClientRect(),
              metaBox = meta.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(meta);
            const lines = Array.from(range.getClientRects());
            return {
              cardWidth: box.width,
              artWidth: art.width,
              ratio: art.width / art.height,
              copyWidth: copy.getBoundingClientRect().width,
              copyScroll: copy.scrollWidth,
              titleWidth: titleBox.width,
              metaWidth: metaBox.width,
              textContained: lines.every(
                (line) => line.left >= box.left - 1 && line.right <= box.right + 1,
              ),
              titleOverflow: getComputedStyle(title).overflow,
              titleTruncation: getComputedStyle(title).textOverflow,
              grid: getComputedStyle(copy).gridTemplateColumns,
            };
          });
          expect(geometry.copyScroll).toBeLessThanOrEqual(geometry.cardWidth + 1);
          expect(geometry.copyWidth).toBeLessThanOrEqual(geometry.cardWidth + 1);
          expect(geometry.titleWidth).toBeLessThanOrEqual(geometry.cardWidth + 1);
          expect(geometry.metaWidth).toBeLessThanOrEqual(geometry.cardWidth + 1);
          expect(geometry.textContained).toBe(true);
          expect(geometry.titleOverflow).toBe("hidden");
          expect(geometry.titleTruncation).toBe("ellipsis");
          expect(Math.abs(geometry.ratio - 16 / 9)).toBeLessThan(0.02);
          expect(Math.abs(geometry.artWidth - geometry.cardWidth)).toBeLessThan(1);
        }
        await cards[0]!.focus();
        await page.keyboard.press(locale === "ar" ? "ArrowLeft" : "ArrowRight");
        await expect(cards[1]!).toBeFocused();
        expect(await cards[1]!.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe(
          "solid",
        );
        await page.screenshot({
          path: info.outputPath(`design-media-card-long-${locale}-${width}.png`),
        });
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(prefix + "/c/" + data.records[1]!.handle + "$"));
      }
    } finally {
      fixture("cleanup", data);
    }
  });
}
