import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

function seed(more = false): { movieSlug: string; seriesSlug: string; channelHandle: string } {
  const result = execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/directory-seed.mjs"), ...(more ? ["--more"] : [])],
    { env: process.env, encoding: "utf8" },
  );
  return JSON.parse(result);
}
test.beforeEach(() => {
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});

test("canonical directories expose real content across desktop, mobile, RTL and TV viewports", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const catalog = seed();
  const entries = [
    {
      route: "/movies",
      title: "Movies",
      ar: "الأفلام",
      name: "Catalog E2E Published Movie",
      href: `/movies/${catalog.movieSlug}`,
    },
    {
      route: "/series",
      title: "Series",
      ar: "المسلسلات",
      name: "Catalog E2E Published Series",
      href: `/series/${catalog.seriesSlug}`,
    },
    {
      route: "/tv",
      title: "TV",
      ar: "التلفزيون",
      name: "Catalog E2E TV",
      href: `/c/${catalog.channelHandle}/tv`,
    },
    {
      route: "/creators",
      title: "Creators",
      ar: "صنّاع المحتوى",
      name: "Catalog E2E Studio",
      href: `/c/${catalog.channelHandle}`,
    },
  ];
  for (const viewport of [
    { width: 390, height: 844, locale: "ar" },
    { width: 1440, height: 1000, locale: "en" },
    { width: 1920, height: 1080, locale: "en" },
  ]) {
    await page.setViewportSize(viewport);
    for (const entry of entries) {
      const prefix = viewport.locale === "ar" ? "/ar" : "";
      await page.goto(`${prefix}${entry.route}?lang=${viewport.locale}`);
      await expect(page.locator("main h1")).toHaveText(
        viewport.locale === "ar" ? entry.ar : entry.title,
      );
      await expect(
        page.locator("main").getByRole("link", { name: new RegExp(`^${entry.name}`) }),
      ).toHaveAttribute("href", `${prefix}${entry.href}`);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        viewport.locale === "ar" ? "rtl" : "ltr",
      );
      await expect(page.getByText("Ready for the next layer")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `directory-${entry.route.slice(1)}-${viewport.width}-${viewport.locale}.png`,
        ),
        fullPage: true,
      });
    }
  }
  await page.goto("/movies?lang=en");
  await page
    .locator("main")
    .getByRole("link", { name: /^Catalog E2E Published Movie/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Catalog E2E Published Movie" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch movie", exact: true })).toBeVisible();
  await page.goto("/series?lang=en");
  await page
    .locator("main")
    .getByRole("link", { name: /^Catalog E2E Published Series/ })
    .click();
  await expect(page.getByRole("heading", { name: "Pilot", exact: true })).toBeVisible();
});

test("catalog pagination can reach all titles and invalid links have a recovery action", async ({
  page,
}) => {
  seed(true);
  await page.goto("/movies");
  const titles = await page.locator("main ul > li strong").allTextContents();
  expect(titles).toHaveLength(24);
  await page.getByRole("link", { name: "Browse more", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.locator("main ul > li strong")).toHaveCount(3);
  const rest = await page.locator("main ul > li strong").allTextContents();
  expect(new Set([...titles, ...rest]).size).toBe(27);
  await page.getByRole("link", { name: "Back to the beginning", exact: true }).click();
  await expect(page.locator("main ul > li strong")).toHaveCount(24);
  await page.goto("/movies?cursor=invalid");
  await expect(
    page.getByRole("heading", { name: "This browsing link is no longer valid" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to the beginning", exact: true }).click();
  await expect(page.locator("main ul > li strong")).toHaveCount(24);
});

test("legacy aliases preserve query and locale, and the served manifest has live shortcuts", async ({
  page,
}) => {
  for (const [source, destination] of [
    ["/shorts", "/clips"],
    ["/uploads", "/upload"],
    ["/ar/shorts", "/ar/clips"],
    ["/ar/uploads", "/ar/upload"],
  ]) {
    const response = await page.request.get(`${source}?source=legacy&keep=1`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    const target = new URL(response.headers().location!, "http://127.0.0.1:3000");
    expect(target.pathname).toBe(destination);
    expect(target.searchParams.get("source")).toBe("legacy");
    expect(target.searchParams.get("keep")).toBe("1");
  }
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.shortcuts.map((shortcut: { url: string }) => shortcut.url)).toEqual([
    "/upload",
    "/tv",
  ]);
  await page.goto("/ar/shorts?source=old");
  await expect(page).toHaveURL(/\/ar\/clips\?source=old$/);
  await expect(page.locator("main")).toBeVisible();
});
