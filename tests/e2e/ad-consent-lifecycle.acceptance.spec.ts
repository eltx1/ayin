import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import type { AdvertisingConsentSnapshot } from "../../apps/web/src/lib/advertising-consent";

const ORIGIN = "http://127.0.0.1:3197";
interface Statistics {
  playCalls: number;
  pauseCalls: number;
  imaStarts: number;
  imaDestroyed: number;
  imaTags: string[];
  gptDefined: number;
  gptDisplayed: number;
  gptDestroyed: number;
  gptQueued: number;
  gptPrivacy: Array<{
    limitedAds?: boolean;
    nonPersonalizedAds?: boolean;
    tagForAgeTreatment?: string;
  }>;
  hlsSources: string[];
  hlsDestroyed: number;
}
interface Harness {
  statistics: Statistics;
  generatedAt: number;
  change(value: AdvertisingConsentSnapshot): void;
  holdGpt(value: boolean): void;
  flushGpt(): void;
  gptRender(index: number): void;
  completeAd(index: number): void;
  lateAd(index: number): void;
  lateHls(): void;
  render(mode: "page" | "video" | "tv" | "empty"): void;
}
declare global {
  interface Window {
    consentHarness: Harness;
  }
}
let bundle = "";
let css = "";

test.beforeAll(async () => {
  // Reuse the lockfile-pinned Vitest/Vite compiler. This test-only bundle loads
  // actual production components; no Next route or browser consent backdoor
  // is added to the shipped app, and no provider/CSP configuration is changed.
  const webRoot = path.resolve(process.cwd(), "apps/web");
  const webRequire = createRequire(path.join(webRoot, "package.json"));
  const vitestRequire = createRequire(webRequire.resolve("vitest/package.json"));
  const { build } = await import(pathToFileURL(vitestRequire.resolve("vite")).href);
  const result = (await build({
    configFile: false,
    root: webRoot,
    logLevel: "silent",
    oxc: { jsx: { runtime: "automatic" } },
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
      "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify(`${ORIGIN}/api`),
      "process.env.NEXT_PUBLIC_MEDIA_BASE_URL": JSON.stringify(`${ORIGIN}/media`),
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        react: path.join(webRoot, "node_modules/react"),
        "react-dom": path.join(webRoot, "node_modules/react-dom"),
        "@ayin/ui": path.resolve(process.cwd(), "packages/ui/src/index.ts"),
        "next/link": path.resolve(process.cwd(), "tests/e2e/fixtures/ad-consent-navigation.tsx"),
        "next/navigation": path.resolve(
          process.cwd(),
          "tests/e2e/fixtures/ad-consent-navigation.tsx",
        ),
      },
    },
    build: {
      write: false,
      minify: false,
      cssCodeSplit: false,
      lib: {
        entry: path.resolve(process.cwd(), "tests/e2e/fixtures/ad-consent-harness.tsx"),
        formats: ["iife"],
        name: "AdvertisingConsentHarness",
      },
    },
  })) as
    | { output: Array<{ type: string; code?: string; source?: string; fileName: string }> }
    | Array<{ output: Array<{ type: string; code?: string; source?: string; fileName: string }> }>;
  const output = Array.isArray(result) ? result.flatMap((entry) => entry.output) : result.output;
  bundle = output
    .filter((output) => output.type === "chunk")
    .map((output) => output.code ?? "")
    .join("\n");
  css = output
    .filter((output) => output.fileName.endsWith(".css"))
    .map((output) => output.source ?? "")
    .join("\n");
  expect(bundle.length).toBeGreaterThan(1000);
});

async function setup(page: Page, videoAds = true, house = false) {
  const events: Array<{ eventType: string; slot?: string }> = [];
  const reads = { page: 0, video: 0, external: 0 };
  await page.route("https://**", async (route) => {
    reads.external++;
    await route.abort();
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
      });
    } else if (url.pathname.includes("/ads/page/decision/")) {
      reads.page++;
      await route.fulfill({
        json: house
          ? {
              enabled: true,
              demand: {
                provider: "HOUSE",
                imageUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
                clickUrl: "https://advertiser.invalid/synthetic",
                altText: "Synthetic house",
              },
              fallback: null,
            }
          : {
              enabled: true,
              demand: { provider: "GOOGLE_GPT", adUnitPath: "/123/synthetic" },
              sizes: [[300, 250]],
              responsive: [],
              fallback: null,
            },
      });
    } else if (url.pathname.includes("/ads/video/decision/")) {
      reads.video++;
      await route.fulfill({
        json: videoAds
          ? {
              enabled: true,
              provider: "GOOGLE_IMA",
              source: "GOOGLE_AD_MANAGER",
              tagUrl:
                "https://securepubads.g.doubleclick.net/gampad/ads?iu=%2F123%2Fsynthetic&tfat=1",
              preRollEnabled: true,
              midRollEnabled: true,
              postRollEnabled: true,
              midRollEverySec: 50,
              frequencyCapPerSession: 20,
              attribution: { videoId: "synthetic-video", channelId: "synthetic-channel" },
            }
          : { enabled: false },
      });
    } else if (/\/ads\/(page|video)\/events/.test(url.pathname)) {
      events.push(route.request().postDataJSON());
      await route.fulfill({ json: { accepted: true } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.goto(ORIGIN);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  return { events, reads };
}

const stats = (page: Page) => page.evaluate(() => window.consentHarness.statistics);

test("trusted consent changes revoke queued/mounted GPT and redecide with explicit age treatment", async ({
  page,
}) => {
  const { events, reads } = await setup(page);
  await page.evaluate(() => {
    window.consentHarness.holdGpt(true);
    window.consentHarness.render("page");
  });
  await expect.poll(async () => (await stats(page)).gptQueued).toBeGreaterThan(0);
  const previousReads = reads.page;
  await page.evaluate(() =>
    window.consentHarness.change({
      mode: "PERSONALIZED",
      source: "CMP",
      providerManaged: true,
      ageTreatment: "CHILD",
    }),
  );
  await expect.poll(() => reads.page).toBeGreaterThan(previousReads);
  await expect.poll(async () => (await stats(page)).gptQueued).toBeGreaterThan(1);
  await page.evaluate(() => window.consentHarness.flushGpt());
  await expect.poll(async () => (await stats(page)).gptDisplayed).toBe(1);
  expect((await stats(page)).gptPrivacy.at(-1)).toEqual({
    nonPersonalizedAds: true,
    tagForAgeTreatment: "synthetic-child",
  });
  await page.evaluate(() => window.consentHarness.gptRender(0));
  await expect
    .poll(() => events.filter((event) => event.eventType === "IMPRESSION").length)
    .toBe(1);
  const before = reads.page;
  const destroyedImmediately = await page.evaluate(() => {
    const host = document.querySelector('[id^="ayin-ad-"]')!.closest("aside")!;
    window.consentHarness.change({
      mode: "LIMITED_ADS",
      source: "CMP",
      providerManaged: true,
      ageTreatment: "CHILD",
    });
    window.consentHarness.gptRender(0);
    return {
      destroyed: window.consentHarness.statistics.gptDestroyed,
      display: getComputedStyle(host).display,
      frames: host.querySelectorAll("iframe").length,
    };
  });
  expect(destroyedImmediately).toEqual({ destroyed: 1, display: "none", frames: 0 });
  await expect.poll(() => reads.page).toBeGreaterThan(before);
  await expect.poll(async () => (await stats(page)).gptDisplayed).toBe(2);
  expect((await stats(page)).gptPrivacy.at(-1)).toEqual({
    limitedAds: true,
    tagForAgeTreatment: "synthetic-child",
  });
  expect(events.filter((event) => event.eventType === "IMPRESSION")).toHaveLength(1);
  const after = reads.page;
  await page.evaluate(() =>
    window.consentHarness.change({
      mode: "LIMITED_ADS",
      source: "CMP",
      providerManaged: true,
      ageTreatment: "CHILD",
    }),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(reads.page).toBe(after);
  expect(reads.external).toBe(0);
});

test("IMA withdrawal preserves content position and fences late callbacks without replaying completed breaks", async ({
  page,
}) => {
  const { events, reads } = await setup(page);
  await page.evaluate(() => window.consentHarness.render("video"));
  await expect.poll(async () => (await stats(page)).imaStarts).toBe(1);
  const video = page.locator("video");
  await video.evaluate((element) => {
    element.dataset.originalContent = "yes";
    element.currentTime = 45;
  });
  const previousReads = reads.video;
  const destroyedImmediately = await page.evaluate(() => {
    const host = document.querySelector('[data-ayin-ad-container="true"]')!;
    window.consentHarness.change({
      mode: "LIMITED_ADS",
      source: "CMP",
      providerManaged: true,
      ageTreatment: "CHILD",
    });
    window.consentHarness.lateAd(0);
    return {
      destroyed: window.consentHarness.statistics.imaDestroyed,
      display: getComputedStyle(host).display,
      frames: host.querySelectorAll("iframe").length,
    };
  });
  expect(destroyedImmediately.destroyed).toBeGreaterThan(0);
  expect(destroyedImmediately.display).toBe("none");
  expect(destroyedImmediately.frames).toBe(0);
  await expect.poll(() => reads.video).toBeGreaterThan(previousReads);
  await expect(video).toHaveAttribute("data-original-content", "yes");
  expect(
    await video.evaluate((element) => ({ time: element.currentTime, paused: element.paused })),
  ).toEqual({ time: 45, paused: false });
  expect((await stats(page)).imaStarts).toBe(1);
  expect(events.filter((event) => event.eventType === "START")).toHaveLength(1);
  await video.evaluate((element) => {
    element.currentTime = 60;
    element.dispatchEvent(new Event("timeupdate"));
  });
  await expect.poll(async () => (await stats(page)).imaStarts).toBe(2);
  const tag = new URL((await stats(page)).imaTags[1]!);
  expect(tag.searchParams.get("ltd")).toBe("1");
  expect(tag.searchParams.get("tfat")).toBe("1");
  await page.evaluate(() => window.consentHarness.completeAd(1));
  const readsBeforeGrant = reads.video;
  await page.evaluate(() =>
    window.consentHarness.change({
      mode: "PERSONALIZED",
      source: "CMP",
      providerManaged: true,
      ageTreatment: "TEEN",
    }),
  );
  await expect.poll(() => reads.video).toBeGreaterThan(readsBeforeGrant);
  await video.evaluate((element) => {
    element.currentTime = 75;
    element.dispatchEvent(new Event("timeupdate"));
  });
  expect((await stats(page)).imaStarts).toBe(2);
  await video.evaluate((element) => element.dispatchEvent(new Event("ended")));
  await expect.poll(async () => (await stats(page)).imaStarts).toBe(3);
  expect(new URL((await stats(page)).imaTags[2]!).searchParams.get("tfat")).toBe("1");
  const playsBeforePostroll = (await stats(page)).playCalls;
  await page.evaluate(() => window.consentHarness.completeAd(2));
  expect((await stats(page)).playCalls).toBe(playsBeforePostroll);
  expect(reads.external).toBe(0);
});

test("DAI revocation tears down live callbacks before switching to the existing MP4 timeline", async ({
  page,
}) => {
  const { reads } = await setup(page, false);
  await page.evaluate(() => window.consentHarness.render("tv"));
  await expect.poll(async () => (await stats(page)).hlsSources.length).toBeGreaterThan(0);
  await expect.poll(async () => (await stats(page)).playCalls).toBeGreaterThan(0);
  const before = await stats(page);
  const transition = await page.evaluate(() => {
    const liveVideo = document.querySelector("main video")!;
    const expectedOffset = Math.min(119750, 30000 + Date.now() - window.consentHarness.generatedAt);
    window.consentHarness.change({
      mode: "LIMITED_ADS",
      source: "CMP",
      providerManaged: true,
      ageTreatment: "CHILD",
    });
    const destroyed = window.consentHarness.statistics.hlsDestroyed;
    const plays = window.consentHarness.statistics.playCalls;
    window.consentHarness.lateHls();
    return {
      expectedOffset,
      destroyed,
      plays,
      afterLatePlays: window.consentHarness.statistics.playCalls,
      display: getComputedStyle(liveVideo).display,
    };
  });
  expect(transition.destroyed).toBeGreaterThan(before.hlsDestroyed);
  expect(transition.afterLatePlays).toBe(transition.plays);
  expect(transition.display).toBe("none");
  const video = page.locator("main video");
  await expect(video).toHaveAttribute("data-synthetic-src", /\/test\.mp4$/);
  const position = await video.evaluate((element) => element.currentTime * 1000);
  expect(position).toBeGreaterThanOrEqual(transition.expectedOffset - 100);
  expect(position).toBeLessThan(transition.expectedOffset + 1000);
  expect((await stats(page)).hlsSources).toHaveLength(before.hlsSources.length);
  await video.evaluate((element) => {
    element.dataset.originalFallback = "yes";
    element.currentTime = 55;
  });
  await page.evaluate(() =>
    window.consentHarness.change({ mode: "PERSONALIZED", source: "CMP", providerManaged: true }),
  );
  await expect(video).toHaveAttribute("data-original-fallback", "yes");
  expect(await video.evaluate((element) => element.currentTime)).toBe(55);
  expect((await stats(page)).hlsSources).toHaveLength(before.hlsSources.length);
  expect(reads.external).toBe(0);
});

test("a same-mode provider revision revokes IMA authority while duplicate notifications preserve playback", async ({
  page,
}) => {
  const { events, reads } = await setup(page);
  await page.evaluate(() => {
    window.consentHarness.change({
      mode: "PERSONALIZED",
      source: "CMP",
      providerManaged: true,
      providerRevision: "policy:1",
    });
    window.consentHarness.render("video");
  });
  await expect.poll(async () => (await stats(page)).imaStarts).toBe(1);
  const video = page.locator("video");
  await video.evaluate((element) => {
    element.dataset.originalContent = "yes";
    element.currentTime = 45;
  });
  const before = reads.video;
  const destroyedBefore = (await stats(page)).imaDestroyed;
  const revoked = await page.evaluate(() => {
    const host = document.querySelector('[data-ayin-ad-container="true"]')!;
    window.consentHarness.change({
      mode: "PERSONALIZED",
      source: "CMP",
      providerManaged: true,
      providerRevision: "policy:2",
    });
    const immediately = {
      destroyed: window.consentHarness.statistics.imaDestroyed,
      display: getComputedStyle(host).display,
      frames: host.querySelectorAll("iframe").length,
    };
    window.consentHarness.lateAd(0);
    return immediately;
  });
  expect(revoked.destroyed).toBeGreaterThan(destroyedBefore);
  expect(revoked.display).toBe("none");
  expect(revoked.frames).toBe(0);
  await expect.poll(() => reads.video).toBeGreaterThan(before);
  await expect(video).toHaveAttribute("data-original-content", "yes");
  expect(
    await video.evaluate((element) => ({ time: element.currentTime, paused: element.paused })),
  ).toEqual({ time: 45, paused: false });
  expect((await stats(page)).imaStarts).toBe(1);
  expect(events.filter((event) => event.eventType === "START")).toHaveLength(1);
  const after = reads.video;
  const destroyed = (await stats(page)).imaDestroyed;
  await page.evaluate(() =>
    window.consentHarness.change({
      mode: "PERSONALIZED",
      source: "CMP",
      providerManaged: true,
      providerRevision: "policy:2",
    }),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(reads.video).toBe(after);
  expect((await stats(page)).imaDestroyed).toBe(destroyed);
  await video.evaluate((element) => {
    element.currentTime = 60;
    element.dispatchEvent(new Event("timeupdate"));
  });
  await expect.poll(async () => (await stats(page)).imaStarts).toBe(2);
  await page.evaluate(() => window.consentHarness.completeAd(1));
  const beforeThird = reads.video;
  await page.evaluate(() =>
    window.consentHarness.change({
      mode: "PERSONALIZED",
      source: "CMP",
      providerManaged: true,
      providerRevision: "policy:3",
    }),
  );
  await expect.poll(() => reads.video).toBeGreaterThan(beforeThird);
  await video.evaluate((element) => {
    element.currentTime = 75;
    element.dispatchEvent(new Event("timeupdate"));
  });
  expect((await stats(page)).imaStarts).toBe(2);
  expect((await stats(page)).imaTags.every((tag) => !tag.includes("policy"))).toBe(true);
  expect(JSON.stringify(events)).not.toContain("policy:");
  expect(reads.external).toBe(0);
});

test("a revoked house creative is hidden immediately and cannot navigate or record a late click", async ({
  page,
}) => {
  const { events, reads } = await setup(page, true, true);
  await page.evaluate(() => window.consentHarness.render("page"));
  await expect(page.getByRole("img", { name: "Synthetic house" })).toBeVisible();
  const revoked = await page.evaluate(() => {
    const link = document.querySelector('a[href="https://advertiser.invalid/synthetic"]')!;
    const host = link.closest("aside")!;
    window.consentHarness.change({
      mode: "LIMITED_ADS",
      source: "CMP",
      providerManaged: true,
      ageTreatment: "CHILD",
    });
    const allowed = link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    return { display: getComputedStyle(host).display, allowed };
  });
  expect(revoked).toEqual({ display: "none", allowed: false });
  expect(events.filter((event) => event.eventType === "CLICK")).toHaveLength(0);
  expect(reads.external).toBe(0);
});
