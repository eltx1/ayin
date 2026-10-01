import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";

async function expectViewerSpacing(
  page: Page,
  route: string,
  layout: { width: number; height: number; locale: string },
  testInfo: Parameters<Parameters<typeof test>[1]>[1],
) {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  const prefix = layout.locale === "ar" ? "/ar" : "";
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
  expect(spacing.top, `${context} preserves its entire padding declaration`).toBeGreaterThanOrEqual(
    24,
  );
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

test("Viewer shell retains real page gutters in desktop, mobile and Arabic layouts", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const layouts = [
    { width: 390, height: 844, locale: "en" },
    { width: 390, height: 844, locale: "ar" },
    { width: 1440, height: 1000, locale: "en" },
  ];

  const communityContext = await browser.newContext();
  const communityPage = await communityContext.newPage();
  try {
    const registration = await communityPage.request.post(`${API}/auth/register`, {
      data: {
        name: "Community spacing viewer",
        email: "community-spacing@e2e.ayin.test",
        password: "strong-pass-123",
      },
      headers: { origin: WEB },
    });
    expect(registration.ok()).toBe(true);

    for (const layout of layouts) {
      for (const route of ["/movies", "/series", "/creators", "/tv", "/upload"]) {
        await expectViewerSpacing(page, route, layout, testInfo);
      }
      await expectViewerSpacing(communityPage, "/community", layout, testInfo);
    }
  } finally {
    await communityContext.close();
  }
});
