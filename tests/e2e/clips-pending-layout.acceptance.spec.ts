import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
test.use({ serviceWorkers: "block", viewport: { width: 360, height: 780 } });

// Real Clips components and decoded local WebM; identity, catalog and social
// responses are synthetic. No database, provider credentials or R2 are used.
test("Arabic mobile Clips keeps controls reachable through pending, failed and recovered social reads", async ({
  page,
}, testInfo) => {
  const videoId = "11111111-1111-4111-8111-111111111111";
  const channelId = "22222222-2222-4222-8222-222222222222";
  const fixtureId = "941d9b97-03e2-4835-8861-558bdbb09fa8";
  const channel = {
    id: channelId,
    handle: `clips-audience-${fixtureId}`,
    name: "Synthetic Clips creator",
  };
  let releaseSocial!: () => void;
  const socialGate = new Promise<void>((resolve) => {
    releaseSocial = resolve;
  });
  let socialReads = 0;
  let socialFailure = true;
  await page.route(`${API}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/auth/me")
      return route.fulfill({
        json: {
          account: {
            id: "33333333-3333-4333-8333-333333333333",
            displayName: "Synthetic viewer",
            email: "layout-viewer@e2e.ayin.test",
          },
          channel,
          creatorTv: { id: "44444444-4444-4444-8444-444444444444", name: "TV", slug: "layout-tv" },
          profile: {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Viewer",
            slug: "layout-viewer",
            isKids: false,
          },
        },
      });
    if (pathname === "/platform/navigation")
      return route.fulfill({ json: { flags: { "navigation.my-ayin": true } } });
    if (pathname === "/product-controls")
      return route.fulfill({
        json: {
          navigation: [
            { key: "home", label: "Home", href: "/", enabled: true, featureFlag: null },
            {
              key: "my-ayin",
              label: "My AYIN",
              href: "/my-ayin",
              enabled: true,
              featureFlag: "navigation.my-ayin",
            },
            { key: "search", label: "Search", href: "/search", enabled: true, featureFlag: null },
          ],
          deviceVisibility: { web: true, mobile: true, tv: true },
          announcement: { enabled: false, text: "", href: null },
          resolvedHero: null,
        },
      });
    if (pathname === "/public/clips")
      return route.fulfill({
        json: {
          viewer: { isKids: false },
          enabled: true,
          autoplayEnabled: true,
          adPolicy: { enabled: false, minimumOrganicClips: 5 },
          nextCursor: null,
          items: [
            {
              id: videoId,
              slug: "synthetic-mobile-clip",
              title: `Clips ${fixtureId} Adult`,
              description: "Synthetic layout fixture.",
              durationMs: 30000,
              channel,
              mediaAssets: [{ kind: "SOURCE_VIDEO", r2ObjectKey: "e2e/layout/canonical.mp4" }],
              _count: { reactions: 0 },
            },
          ],
        },
      });
    if (pathname.startsWith("/social/")) {
      socialReads++;
      await socialGate;
      if (socialFailure)
        return route.fulfill({ status: 500, json: { error: { code: "SYNTHETIC_UNAVAILABLE" } } });
      return route.fulfill({
        json: pathname.includes("/videos/")
          ? { videoId, reaction: null, likeCount: 0, watchLater: false, myList: false }
          : { channelId, subscribed: false, subscriberCount: 0 },
      });
    }
    return route.fulfill({ status: 404, json: { error: { code: "SYNTHETIC_UNAVAILABLE" } } });
  });
  const bytes = readFileSync(path.resolve("tests/e2e/fixtures/clips-viewport.webm"));
  await page.route("**/e2e/layout/canonical.mp4", async (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: "video/webm",
      headers: {
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
      },
      body: bytes.subarray(start, end + 1),
    });
  });
  try {
    await page.goto("/clips?lang=ar");
    const active = page.locator("[data-clip-active='true']");
    await expect.poll(() => socialReads).toBe(2);
    await expect
      .poll(() =>
        active
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames),
      )
      .toBeGreaterThan(0);
    await expect(active.getByRole("status")).toContainText("جارٍ تحميل إجراءاتك");
    for (const state of ["pending", "failed", "ready"] as const) {
      if (state === "failed") {
        releaseSocial();
        await expect(active.getByRole("alert")).toContainText("تعذر تحميل إجراءات المقطع");
      }
      if (state === "ready") {
        socialFailure = false;
        await active.getByRole("button", { name: "تحديث الإجراءات", exact: true }).click();
        await expect(active.getByRole("button", { name: "اشتراك", exact: true })).toBeEnabled();
        await expect(active.getByRole("status")).toHaveCount(0);
        await expect(active.getByRole("alert")).toHaveCount(0);
      }
      const geometry = await active.evaluate((article) => {
        const bottom = document
          .querySelector("[data-ayin-bottom-navigation]")!
          .getBoundingClientRect().top;
        return [
          ...article.querySelectorAll("button,input,a"),
          ...document.querySelectorAll("[data-ayin-bottom-navigation] a"),
        ]
          .filter((node) => node.getBoundingClientRect().height > 0)
          .map((node) => {
            const box = node.getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return {
              label: node.getAttribute("aria-label") ?? node.textContent,
              recovery: node.getAttribute("data-tv-focus-id")?.endsWith("-actions-refresh"),
              bottom: box.bottom,
              usableBottom: node.closest("[data-ayin-bottom-navigation]") ? innerHeight : bottom,
              hit: !!hit && (hit === node || node.contains(hit)),
            };
          });
      });
      await testInfo.attach(`clips-controls-${state}`, {
        body: JSON.stringify(geometry),
        contentType: "application/json",
      });
      for (const control of geometry) {
        if (state === "failed" && control.recovery) continue;
        expect(control.bottom, `${state}: ${control.label}`).toBeLessThanOrEqual(
          control.usableBottom + 1,
        );
        expect(control.hit, `${state}: ${control.label}`).toBe(true);
      }
      if (state === "failed") {
        // Long error copy uses the existing bounded metadata scroller. Recovery
        // must stay reachable without moving the page beneath mobile navigation.
        const pageScroll = await page.evaluate(() => scrollY);
        const retry = active.getByRole("button", { name: "تحديث الإجراءات", exact: true });
        await active.locator("[data-clip-metadata]").evaluate((metadata) => {
          metadata.scrollTop = metadata.scrollHeight;
        });
        const recovery = await retry.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const metadata = button.closest("[data-clip-metadata]")!;
          const navigation = document.querySelector("[data-ayin-bottom-navigation]")!;
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            bottom: box.bottom,
            usableBottom: navigation.getBoundingClientRect().top,
            metadataScroll: metadata.scrollTop,
            pageScroll: scrollY,
            hit: !!hit && (hit === button || button.contains(hit)),
          };
        });
        await testInfo.attach("clips-recovery-scrolled", {
          body: JSON.stringify(recovery),
          contentType: "application/json",
        });
        expect(recovery.metadataScroll).toBeGreaterThan(0);
        expect(recovery.pageScroll).toBe(pageScroll);
        expect(recovery.bottom).toBeLessThanOrEqual(recovery.usableBottom + 1);
        expect(recovery.hit).toBe(true);
      }
    }
  } finally {
    releaseSocial();
  }
});
