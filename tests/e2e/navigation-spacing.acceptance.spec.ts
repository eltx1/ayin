import { expect, test } from "@playwright/test";

test("Viewer shell retains real page gutters in desktop, mobile and Arabic layouts", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const layouts = [
    { width: 390, height: 844, locale: "en" },
    { width: 390, height: 844, locale: "ar" },
    { width: 1440, height: 1000, locale: "en" },
  ];
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    const prefix = layout.locale === "ar" ? "/ar" : "";
    for (const route of ["/movies", "/series", "/creators", "/tv", "/upload", "/community"]) {
      await page.goto(`${prefix}${route}?lang=${layout.locale}`);
      const main = page.getByRole("main");
      await expect(main).toHaveCount(1);
      await expect(main).toBeVisible();
      const spacing = await main.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          start: Number.parseFloat(style.paddingInlineStart),
          end: Number.parseFloat(style.paddingInlineEnd),
          top: Number.parseFloat(style.paddingBlockStart),
          token: style.getPropertyValue("--shell-gutter").trim(),
        };
      });
      const context = `${layout.locale} ${layout.width}px ${route}`;
      expect(spacing.token, `${context} inherits the shell gutter`).not.toBe("");
      expect(spacing.start, `${context} has start padding`).toBeGreaterThanOrEqual(16);
      expect(spacing.end, `${context} has end padding`).toBeGreaterThanOrEqual(16);
      expect(
        spacing.top,
        `${context} preserves its entire padding declaration`,
      ).toBeGreaterThanOrEqual(24);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
        `${context} does not overflow`,
      ).toBe(true);
      if (route === "/movies") {
        await page.screenshot({
          path: testInfo.outputPath(`navigation-gutters-${layout.width}-${layout.locale}.png`),
          fullPage: true,
        });
      }
    }
  }
});
