import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
type Video = { id: string; title: string; slug: string };
type Fixture = {
  handle: string;
  oldHandle: string;
  playlistSlug: string;
  videos: Record<"general" | "teen" | "expired" | "restricted" | "blocked", Video>;
};
function fixture(): Fixture {
  return JSON.parse(
    execFileSync(process.execPath, [path.resolve("tests/e2e/public-policy-fixture.mjs")], {
      encoding: "utf8",
      env: process.env,
    }),
  ) as Fixture;
}
async function expectReadableAboveNavigation(page: Page, card: Locator) {
  await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect
    .poll(async () => {
      const bounds = await card.boundingBox();
      const navigation = await page
        .getByRole("navigation", { name: /^(Mobile navigation|التنقل على الهاتف)$/ })
        .boundingBox();
      return Boolean(
        bounds &&
        navigation &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= navigation.y &&
        navigation.height > 0 &&
        navigation.y > 0 &&
        navigation.y + navigation.height <= (page.viewportSize()?.height ?? 0) + 1,
      );
    })
    .toBe(true);
  await expect(card).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
for (const locale of ["en", "ar"] as const)
  test(`real channel and playlist preserve eligible Kids destinations and localized cards ${locale}`, async ({
    page,
  }, info) => {
    const f = fixture();
    const socialReads: string[] = [];
    page.on("request", (request) => {
      if (/\/social\/channels\//.test(new URL(request.url()).pathname))
        socialReads.push(request.url());
    });
    await page.setExtraHTTPHeaders({ "cf-ipcountry": "DE" });
    const prefix = locale === "ar" ? "/ar" : "";
    const channel = `${prefix}/c/${f.handle}?kids=1&tab=videos&lang=${locale}`;
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(channel);
      const main = page.locator("main:visible");
      await expect(
        main.getByRole("heading", { name: "Actual eligible creator", exact: true }),
      ).toBeVisible();
      await expect(main.locator('[data-tv-focus-id$="-subscription"]')).toHaveCount(0);
      await expect(
        main.getByRole("link", { name: /Manage TV|Edit channel|إدارة البث|تعديل القناة/ }),
      ).toHaveCount(0);
      await expect(
        main.getByRole("link", { name: new RegExp(f.videos.general.title) }),
      ).toHaveAttribute("href", `${prefix}/watch/${f.videos.general.slug}?kids=1`);
      await expect(
        main.getByRole("link", { name: new RegExp(f.videos.restricted.title) }),
      ).toHaveAttribute("href", `${prefix}/watch/${f.videos.restricted.slug}?kids=1`);
      for (const key of ["teen", "expired", "blocked"] as const) {
        await expect(main.getByText(f.videos[key].title, { exact: true })).toHaveCount(0);
        expect(await page.content()).not.toContain(f.videos[key].id);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      if (width === 390) {
        await expectReadableAboveNavigation(
          page,
          main.getByRole("link", { name: new RegExp(f.videos.general.title) }),
        );
        await page.screenshot({
          path: info.outputPath(`design-policy-channel-${locale}-${width}-card-viewport.png`),
        });
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: info.outputPath(`design-policy-channel-${locale}-${width}.png`),
        fullPage: true,
      });
      await page.goto(`${prefix}/c/${f.handle}?kids=1&tab=playlists&lang=${locale}`);
      const link = main.getByRole("link", { name: /Actual eligible collection/ });
      await expect(link).toHaveAttribute(
        "href",
        `${prefix}/c/${f.handle}/playlists/${f.playlistSlug}?kids=1`,
      );
      await link.click();
      await expect(
        main.getByRole("heading", { level: 1, name: "Actual eligible collection" }),
      ).toBeVisible();
      await expect(
        main.getByRole("link", { name: new RegExp(f.videos.general.title) }),
      ).toHaveAttribute("href", `${prefix}/watch/${f.videos.general.slug}?kids=1`);
      await expect(
        main.getByRole("link", { name: new RegExp(f.videos.restricted.title) }),
      ).toBeVisible();
      for (const key of ["teen", "expired", "blocked"] as const) {
        await expect(main.getByText(f.videos[key].title, { exact: true })).toHaveCount(0);
        expect(await page.content()).not.toContain(f.videos[key].id);
      }
      await expect(main.locator('script[type="application/ld+json"]')).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      if (width === 390) {
        await expectReadableAboveNavigation(
          page,
          main.getByRole("link", { name: new RegExp(f.videos.general.title) }),
        );
        await page.screenshot({
          path: info.outputPath(`design-policy-playlist-${locale}-${width}-card-viewport.png`),
        });
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: info.outputPath(`design-policy-playlist-${locale}-${width}.png`),
        fullPage: true,
      });
    }
    expect(socialReads).toEqual([]);
    await page.goto(`${prefix}/c/${f.oldHandle}/playlists/${f.playlistSlug}?kids=1&lang=${locale}`);
    await expect(page).toHaveURL(new RegExp(`/c/${f.handle}/playlists/${f.playlistSlug}\\?kids=1`));
    await expect(
      page.locator("main:visible").getByRole("link", { name: new RegExp(f.videos.general.title) }),
    ).toHaveAttribute("href", `${prefix}/watch/${f.videos.general.slug}?kids=1`);
  });
test("real same-URL channel and playlist change territory without showing blocked metadata or retaining stale facts", async ({
  page,
}) => {
  const f = fixture();
  for (const target of [
    `/c/${f.handle}?tab=videos`,
    `/c/${f.handle}/playlists/${f.playlistSlug}`,
  ]) {
    await page.setExtraHTTPHeaders({ "cf-ipcountry": "DE" });
    await page.goto(target);
    await expect(
      page
        .locator("main:visible")
        .getByRole("link", { name: new RegExp(f.videos.restricted.title) }),
    ).toBeVisible();
    await expect(
      page.locator("main:visible").getByRole("link", { name: new RegExp(f.videos.teen.title) }),
    ).toBeVisible();
    await page.setExtraHTTPHeaders({ "cf-ipcountry": "US" });
    await page.goto(target);
    await expect(
      page.locator("main:visible").getByText(f.videos.restricted.title, { exact: true }),
    ).toHaveCount(0);
    expect(await page.content()).not.toContain(f.videos.restricted.id);
    for (const key of ["expired", "blocked"] as const)
      expect(await page.content()).not.toContain(f.videos[key].id);
    await expect(
      page.locator("main:visible").getByRole("link", { name: new RegExp(f.videos.general.title) }),
    ).toBeVisible();
  }
});
