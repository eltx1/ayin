import { expect, test } from "@playwright/test";

const paths = ["privacy", "terms", "community-guidelines", "copyright", "creator-terms", "cookies"];

for (const locale of ["en", "ar"] as const) {
  for (const width of [390, 1440]) {
    test(`${locale} ${width}: six policy destinations retain shell locale and document reading order`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/privacy?lang=${locale}`);
      const prefix = locale === "ar" ? "/ar" : "";
      for (const path of paths) {
        const link = page.locator(`footer a[href="${prefix}/${path}"]`).first();
        await expect(link).toBeVisible();
        await link.focus();
        await link.press("Enter");
        await expect.poll(() => new URL(page.url()).pathname).toBe(`${prefix}/${path}`);
        await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await expect(main).toHaveAttribute("lang", "en");
        await expect(main).toHaveAttribute("dir", "ltr");
        await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await main.getByRole("heading", { level: 2 }).count()).toBeGreaterThan(0);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
      }
      await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`legal-navigation-${locale}-${width}.png`) });
    });
  }
}
