import { expect, test } from "@playwright/test";

test("publishes crawl controls and the sitemap index", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  const robotsText = await robots.text();
  expect(robotsText).toContain("User-Agent: *");
  expect(robotsText).toContain("Disallow: /studio/");
  expect(robotsText).toContain("/sitemap.xml");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(sitemap.headers()["content-type"]).toContain("application/xml");
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain("<sitemapindex");
  expect(sitemapText).toContain("/sitemaps/static.xml");

  const staticSitemap = await request.get("/sitemaps/static.xml");
  expect(staticSitemap.ok()).toBe(true);
  const staticText = await staticSitemap.text();
  expect(staticText).toContain("/privacy");
  expect(staticText).toContain("/terms");
});
