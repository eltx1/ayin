import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const seededClipIds = new Map<string, string[]>();
const nativePseudos = {
  play: "-webkit-media-controls-play-button",
  timeline: "-webkit-media-controls-timeline",
  fullscreen: "-webkit-media-controls-fullscreen-button",
} as const;

interface Clip {
  id: string;
  slug: string;
  title: string;
}
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
interface ShadowNode {
  backendNodeId: number;
  attributes?: string[];
  children?: ShadowNode[];
  shadowRoots?: ShadowNode[];
  shadowRootType?: string;
}
interface NativeControl {
  pseudo: string;
  label: string | null;
  box: Rect;
}

test.use({ serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } });

test.afterEach(({ browserName }, testInfo) => {
  expect(browserName).toBe("chromium");
  const videoIds = seededClipIds.get(testInfo.testId);
  if (!videoIds) return;
  const result = runFixture<{ count: number }>("player-progress-fixture.mjs", "hide-clips", {
    videoIds,
  });
  expect(result.count).toBe(videoIds.length);
  seededClipIds.delete(testInfo.testId);
});

function runFixture<T>(file: string, command: string, payload: object = {}): T {
  if (!process.env.TEST_DATABASE_URL) throw new Error("An isolated TEST_DATABASE_URL is required.");
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve(process.cwd(), "tests/e2e", file), command, JSON.stringify(payload)],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" },
    ),
  ) as T;
}

function seedClips(testInfo: TestInfo): Clip[] {
  const { items } = runFixture<{ items: Clip[] }>("db-helper.mjs", "seed-clips-viewer");
  seededClipIds.set(
    testInfo.testId,
    items.map((item) => item.id),
  );
  expect(items).toHaveLength(22);
  expect(new Set(items.map((item) => item.id)).size).toBe(22);
  return items;
}

function article(page: Page, id: string) {
  return page.locator(`[data-clip-item='true'][data-video-id='${id}']`);
}

async function register(page: Page, label: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Clips layout viewer",
      email: `progress-clips-layout-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.status()).toBe(201);
}

// Only the media bytes are substituted. Auth, social requests, progress, API,
// PostgreSQL, the media element and Chromium's UA controls remain real.
async function installDecodedMedia(page: Page) {
  const bytes = readFileSync(path.resolve(process.cwd(), "tests/e2e/fixtures/clips-viewport.webm"));
  await page.route("**/e2e/clips/**/canonical.mp4", async (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) {
      return route.fulfill({
        status: 200,
        contentType: "video/webm",
        headers: { "accept-ranges": "bytes" },
        body: bytes,
      });
    }
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end) {
      return route.fulfill({
        status: 416,
        headers: { "content-range": `bytes */${bytes.length}` },
      });
    }
    await route.fulfill({
      status: 206,
      contentType: "video/webm",
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${bytes.length}`,
      },
      body: bytes.subarray(start, end + 1),
    });
  });
}

async function pauseDecodedFrame(page: Page, id: string) {
  const video = article(page, id).locator("video");
  await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.readyState)).toBe(4);
  await enableNativeControls(page, id);
  await video.evaluate(async (media: HTMLVideoElement) => {
    await media.play();
  });
  await expect
    .poll(() =>
      video.evaluate((media: HTMLVideoElement) => media.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0);
  await video.evaluate((media: HTMLVideoElement) => {
    media.pause();
    media.currentTime = 1;
  });
  await expect
    .poll(() =>
      video.evaluate(
        (media: HTMLVideoElement) =>
          media.paused && !media.seeking && Math.abs(media.currentTime - 1) < 0.05,
      ),
    )
    .toBe(true);
}

async function geometry(page: Page, id: string) {
  return article(page, id).evaluate((element: HTMLElement) => {
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const header = document.querySelector('[data-tv-focus-id="brand-home"]')?.closest("header");
    const feed = element.parentElement;
    const video = element.querySelector("video");
    const panel = element.querySelector("h2")?.parentElement?.parentElement;
    if (!header || !feed || !video || !panel)
      throw new Error("Clips layout landmarks are missing.");
    const mobile = [...document.querySelectorAll("nav[data-mobile-visible]")].find(
      (node) =>
        getComputedStyle(node).position === "fixed" && node.getBoundingClientRect().height > 0,
    );
    const usable = {
      left: 0,
      right: innerWidth,
      top: Math.max(0, rect(header).bottom),
      bottom: mobile ? rect(mobile).top : innerHeight,
    };
    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        direction: getComputedStyle(element).direction,
      },
      scrollY,
      feedScrollTop: feed.scrollTop,
      header: rect(header),
      mobile: mobile ? rect(mobile) : null,
      usable,
      article: rect(element),
      feed: rect(feed),
      video: rect(video),
      panel: {
        ...rect(panel),
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
      },
      media: {
        currentTime: video.currentTime,
        duration: video.duration,
        readyState: video.readyState,
        paused: video.paused,
        seeking: video.seeking,
        error: video.error?.code ?? null,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
      },
      controls: [...element.querySelectorAll("button,a,h2,p")]
        .filter(
          (control) =>
            control.getBoundingClientRect().width > 0 && control.getBoundingClientRect().height > 0,
        )
        .map((control) => {
          const box = rect(control);
          const fragments = [...control.getClientRects()]
            .filter((fragment) => fragment.width > 0 && fragment.height > 0)
            .map((fragment) => ({
              left: fragment.left,
              top: fragment.top,
              right: fragment.right,
              bottom: fragment.bottom,
              width: fragment.width,
              height: fragment.height,
            }));
          // A wrapped inline link's union box includes the gap between lines.
          // Hit-test every rendered fragment, retaining the union for containment.
          const points = fragments.flatMap((fragment) =>
            [0.25, 0.5, 0.75].map((fraction) => ({
              x: fragment.left + fragment.width * fraction,
              y: fragment.top + fragment.height / 2,
            })),
          );
          return {
            tag: control.tagName,
            label: control.textContent?.trim().slice(0, 160) ?? "",
            box,
            fragments,
            hitTests: control.matches("button,a")
              ? points.map((point) => {
                  const hit = document.elementFromPoint(point.x, point.y);
                  return {
                    ...point,
                    hit: hit?.tagName ?? null,
                    passes: Boolean(hit && (hit === control || control.contains(hit))),
                  };
                })
              : [],
          };
        }),
    };
  });
}

async function nativeBounds(page: Page, id: string) {
  const client = await page.context().newCDPSession(page);
  try {
    const document = await client.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await client.send("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: `[data-clip-item='true'][data-video-id='${id}'] video`,
    });
    const { node } = await client.send("DOM.describeNode", { nodeId, depth: -1, pierce: true });
    const model = await client.send("DOM.getBoxModel", { nodeId });
    const video = await article(page, id).locator("video").boundingBox();
    if (!video) throw new Error("The real video has no bounds.");
    // DOM box quads and Playwright viewport coordinates can have different
    // origins after document scrolling. Calibrate with this same video node.
    const offset = { x: video.x - model.model.border[0], y: video.y - model.model.border[1] };
    const controls: NativeControl[] = [];
    const hiddenControls: Array<{
      pseudo: string;
      label: string | null;
      reason: "no-box" | "zero-box";
    }> = [];
    const visit = async (current: ShadowNode): Promise<void> => {
      const attributes: Record<string, string> = {};
      for (let index = 0; index < (current.attributes?.length ?? 0); index += 2) {
        attributes[current.attributes![index]!] = current.attributes![index + 1]!;
      }
      if (Object.values(nativePseudos).some((pseudo) => pseudo === attributes.pseudo)) {
        const identity = { pseudo: attributes.pseudo, label: attributes["aria-label"] ?? null };
        let quad: number[] | undefined;
        try {
          const result = await client.send("DOM.getBoxModel", {
            backendNodeId: current.backendNodeId,
          });
          quad = result.model.border;
        } catch (error) {
          // Chromium also keeps hidden copies for its overflow menu. Ignore
          // only this known no-layout result; other CDP failures still fail.
          if (!(error instanceof Error) || !error.message.includes("Could not compute box model"))
            throw error;
          hiddenControls.push({ ...identity, reason: "no-box" });
        }
        if (quad) {
          const left = Math.min(quad[0], quad[2], quad[4], quad[6]) + offset.x;
          const top = Math.min(quad[1], quad[3], quad[5], quad[7]) + offset.y;
          const right = Math.max(quad[0], quad[2], quad[4], quad[6]) + offset.x;
          const bottom = Math.max(quad[1], quad[3], quad[5], quad[7]) + offset.y;
          if (right <= left || bottom <= top) {
            hiddenControls.push({ ...identity, reason: "zero-box" });
          } else {
            controls.push({
              ...identity,
              box: { left, top, right, bottom, width: right - left, height: bottom - top },
            });
          }
        }
      }
      for (const child of [...(current.children ?? []), ...(current.shadowRoots ?? [])])
        await visit(child);
    };
    await visit(node);
    expect(node.shadowRoots?.map((root) => root.shadowRootType)).toContain("user-agent");
    for (const pseudo of Object.values(nativePseudos)) {
      expect(
        controls.filter((control) => control.pseudo === pseudo),
        pseudo,
      ).toHaveLength(1);
    }
    return {
      shadowRoots: node.shadowRoots?.map((root) => root.shadowRootType),
      controls,
      hiddenControls,
    };
  } finally {
    await client.detach();
  }
}

function fits(inner: Rect, outer: Pick<Rect, "left" | "right" | "top" | "bottom">) {
  return (
    inner.left >= outer.left - 1 &&
    inner.right <= outer.right + 1 &&
    inner.top >= outer.top - 1 &&
    inner.bottom <= outer.bottom + 1
  );
}

function overlaps(first: Rect, second: Rect) {
  return (
    Math.min(first.right, second.right) - Math.max(first.left, second.left) > 0.5 &&
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 0.5
  );
}

function assertLayout(
  bounds: Awaited<ReturnType<typeof geometry>>,
  native: Awaited<ReturnType<typeof nativeBounds>>,
  longDescription = false,
) {
  expect(fits(bounds.feed, bounds.usable), "Feed fits between the measured shell bars").toBe(true);
  expect(fits(bounds.article, bounds.usable), "Selected article fits the usable viewport").toBe(
    true,
  );
  expect(fits(bounds.article, bounds.feed), "Selected article fits the feed").toBe(true);
  expect(fits(bounds.video, bounds.article)).toBe(true);
  expect(fits(bounds.panel, bounds.article)).toBe(true);
  expect(bounds.video.height).toBeGreaterThan(0);
  expect(bounds.video.width).toBeGreaterThan(0);
  expect(
    overlaps(bounds.video, bounds.panel),
    "Native video and metadata occupy separate rows",
  ).toBe(false);
  expect(bounds.media).toMatchObject({ paused: true, seeking: false, error: null, readyState: 4 });
  expect(bounds.media.videoWidth).toBeGreaterThan(0);
  expect(bounds.media.videoHeight).toBeGreaterThan(0);
  expect(bounds.media.decodedFrames).toBeGreaterThan(0);
  expect(
    bounds.controls.filter((control) => control.tag === "BUTTON").length,
  ).toBeGreaterThanOrEqual(6);
  for (const control of bounds.controls) {
    if (longDescription && control.tag === "P") continue;
    expect(fits(control.box, bounds.usable), control.label).toBe(true);
    expect(fits(control.box, bounds.article), control.label).toBe(true);
    if (control.tag === "BUTTON" || control.tag === "A")
      expect(control.hitTests.length, `${control.label} has rendered hit targets`).toBeGreaterThan(
        0,
      );
    for (const hit of control.hitTests) expect(hit.passes, control.label).toBe(true);
    if (control.tag === "BUTTON") {
      expect(control.box.width, control.label).toBeGreaterThanOrEqual(44);
      expect(control.box.height, control.label).toBeGreaterThanOrEqual(44);
    }
  }
  for (const control of native.controls) {
    expect(control.box.width, control.pseudo).toBeGreaterThan(0);
    expect(control.box.height, control.pseudo).toBeGreaterThan(0);
    expect(fits(control.box, bounds.video), control.pseudo).toBe(true);
    expect(fits(control.box, bounds.usable), control.pseudo).toBe(true);
    expect(overlaps(control.box, bounds.panel), `${control.pseudo} clears metadata panel`).toBe(
      false,
    );
    for (const custom of bounds.controls) {
      expect(overlaps(control.box, custom.box), `${control.pseudo} clears ${custom.label}`).toBe(
        false,
      );
    }
  }
}

async function enableNativeControls(page: Page, id: string) {
  const native = article(page, id).locator(`[data-tv-focus-id="clip-${id}-native"]`);
  if (await native.count()) await native.click();
  await expect(article(page, id).locator("video")).toHaveAttribute("controls", "");
}

async function revealNativeControls(page: Page, id: string) {
  await enableNativeControls(page, id);
  const box = await article(page, id).locator("video").boundingBox();
  if (!box) throw new Error("The real video has no bounds.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12);
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const output = testInfo.outputPath(`clips-layout-${name}.json`);
  writeFileSync(output, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path: output, contentType: "application/json" });
}

async function capture(page: Page, id: string, name: string, testInfo: TestInfo) {
  await revealNativeControls(page, id);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const bounds = await geometry(page, id);
  const native = await nativeBounds(page, id);
  await attachJson(testInfo, `${name}-bounds`, { bounds, native });
  const screenshot = testInfo.outputPath(`clips-layout-${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: false, animations: "disabled" });
  await testInfo.attach(`${name}-viewport-original`, {
    path: screenshot,
    contentType: "image/png",
  });
  return { bounds, native };
}

async function clickNative(
  page: Page,
  id: string,
  kind: keyof typeof nativePseudos,
  fraction = 0.5,
) {
  await revealNativeControls(page, id);
  const native = await nativeBounds(page, id);
  const control = native.controls.find((item) => item.pseudo === nativePseudos[kind]);
  if (!control) throw new Error(`Missing native ${kind} control.`);
  const point = {
    x: control.box.left + control.box.width * fraction,
    y: control.box.top + control.box.height / 2,
  };
  expect(
    await article(page, id)
      .locator("video")
      .evaluate((video, target) => document.elementFromPoint(target.x, target.y) === video, point),
    `Native ${kind} hit target is the video`,
  ).toBe(true);
  await page.mouse.click(point.x, point.y);
}

async function exerciseNativeControls(page: Page, id: string, label: string, testInfo: TestInfo) {
  const video = article(page, id).locator("video");
  const start = await video.evaluate((media: HTMLVideoElement) => media.currentTime);
  await clickNative(page, id, "play");
  await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.paused)).toBe(false);
  await expect
    .poll(() => video.evaluate((media: HTMLVideoElement) => media.currentTime))
    .toBeGreaterThan(start + 0.1);
  await clickNative(page, id, "play");
  await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.paused)).toBe(true);
  const beforeSeek = await video.evaluate((media: HTMLVideoElement) => media.currentTime);
  await clickNative(page, id, "timeline", 0.72);
  await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.seeking)).toBe(false);
  await expect
    .poll(() => video.evaluate((media: HTMLVideoElement) => media.currentTime))
    .toBeGreaterThan(beforeSeek + 3);
  const afterSeek = await video.evaluate((media: HTMLVideoElement) => ({
    currentTime: media.currentTime,
    duration: media.duration,
    paused: media.paused,
  }));
  expect(afterSeek.currentTime).toBeLessThan(afterSeek.duration - 1);
  expect(afterSeek.paused).toBe(true);
  await clickNative(page, id, "fullscreen");
  await expect
    .poll(() => video.evaluate((media) => document.fullscreenElement === media))
    .toBe(true);
  const fullscreen = await nativeBounds(page, id);
  await clickNative(page, id, "fullscreen");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await attachJson(testInfo, `${label}-native-mouse-actions`, {
    start,
    beforeSeek,
    afterSeek,
    enteredFullscreen: true,
    exitedFullscreen: true,
    fullscreen,
  });
}

async function navigate(page: Page, id: string, key: "ArrowDown" | "ArrowUp") {
  // Native-control interaction owns keyboard focus. Explicitly return to the
  // article surface before testing its arrow navigation; never scroll either
  // viewport here. Uninterrupted keyboard focus is covered separately.
  await page
    .locator("[data-clip-active='true']")
    .evaluate((node: HTMLElement) => node.focus({ preventScroll: true }));
  await page.keyboard.press(key);
  await expect(article(page, id)).toBeFocused();
  await expect(article(page, id).locator(`[data-tv-focus-id="clip-${id}-like"]`)).toBeEnabled();
  await expect(article(page, id).getByRole("button").first()).toBeEnabled();
  // Observe the application's scroll result, including smooth completion.
  // Never scrollIntoView, locator.click, or manually repair either scrollport.
  await expect
    .poll(async () => {
      const bounds = await geometry(page, id);
      return (
        fits(bounds.feed, bounds.usable) &&
        fits(bounds.article, bounds.usable) &&
        fits(bounds.article, bounds.feed)
      );
    })
    .toBe(true);
}

async function longDescription(page: Page, id: string, testInfo: TestInfo) {
  const end = "نهاية الوصف الكامل. End of the complete recording notes.";
  const text = `${"ملاحظات التصوير العربية Arabic camera and sound notes. ".repeat(500).slice(0, 20_000 - end.length)}${end}`;
  expect(text).toHaveLength(20_000);
  const trigger = article(page, id).getByRole("button", { name: "التفاصيل", exact: true });
  const initial = await geometry(page, id);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "التفاصيل", exact: true });
  // Content-only seam at the supported limit. The real dialog, scrolling,
  // focus, media and layout handlers stay in control.
  const description = dialog.locator("p[dir='auto']");
  await description.evaluate((paragraph, value) => {
    paragraph.textContent = value;
  }, text);
  await expect
    .poll(() => dialog.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);
  const box = await dialog.boundingBox();
  if (!box) throw new Error("Description dialog missing bounds.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
  await page.mouse.wheel(0, 100000);
  await expect
    .poll(() =>
      dialog.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1),
    )
    .toBe(true);
  const lastLine = await description.evaluate((paragraph) => {
    const textNode = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length - 1);
    range.setEnd(textNode, textNode.textContent!.length);
    const rect = range.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });
  expect(lastLine.top).toBeGreaterThanOrEqual(0);
  expect(lastLine.bottom).toBeLessThanOrEqual(844);
  expect(await article(page, id).getAttribute("data-clip-active")).toBe("true");
  const screenshot = testInfo.outputPath("clips-layout-ar-390-long-description-sheet.png");
  await page.screenshot({ path: screenshot, fullPage: false });
  await testInfo.attach("ar-390-full-description-sheet", {
    path: screenshot,
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const after = await geometry(page, id);
  expect(after.feedScrollTop).toBe(initial.feedScrollTop);
  expect(after.scrollY).toBe(initial.scrollY);
  expect(after.video).toEqual(initial.video);
  await exerciseNativeControls(page, id, "ar-390-long-description", testInfo);
}

// Exactly four Chromium cases: EN/AR × desktop/mobile. The AR mobile case also
// covers one 20,000-character description; EN mobile repeats navigation with
// normal smooth motion. These are synthetic local-decoder checks, not device
// or external-provider playback certification.
for (const locale of ["en", "ar"] as const) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`Clips native controls and keyboard layout ${locale} ${viewport.width}x${viewport.height}`, async ({
      page,
      browserName,
    }, testInfo) => {
      test.setTimeout(120_000);
      expect(browserName).toBe("chromium");
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      ).toBe(true);
      const label = `${locale}-${viewport.width}`;
      const [first, second] = seedClips(testInfo);
      await register(page, label);
      await installDecodedMedia(page);
      await page.goto(locale === "ar" ? "/ar/clips?lang=ar" : "/clips?lang=en");
      await expect(article(page, first.id).getByRole("button").first()).toBeEnabled();
      // Use the product's own navigation to expose the feed from the natural
      // page position; no manually centered or corrected viewport is claimed.
      await article(page, first.id).evaluate((element: HTMLElement) =>
        element.focus({ preventScroll: true }),
      );
      await navigate(page, second.id, "ArrowDown");
      await navigate(page, first.id, "ArrowUp");
      await pauseDecodedFrame(page, first.id);
      const initial = await capture(page, first.id, `${label}-settled`, testInfo);
      expect(initial.bounds.viewport.direction).toBe(locale === "ar" ? "rtl" : "ltr");
      assertLayout(initial.bounds, initial.native);
      await exerciseNativeControls(page, first.id, label, testInfo);

      await article(page, first.id).evaluate((element: HTMLElement) =>
        element.focus({ preventScroll: true }),
      );
      await navigate(page, second.id, "ArrowDown");
      await pauseDecodedFrame(page, second.id);
      const down = await capture(page, second.id, `${label}-keyboard-down-uncorrected`, testInfo);
      assertLayout(down.bounds, down.native);
      await navigate(page, first.id, "ArrowUp");
      await pauseDecodedFrame(page, first.id);
      const up = await capture(page, first.id, `${label}-keyboard-up-uncorrected`, testInfo);
      assertLayout(up.bounds, up.native);

      if (locale === "en" && viewport.width === 390) {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        expect(
          await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
        ).toBe(false);
        await navigate(page, second.id, "ArrowDown");
        await pauseDecodedFrame(page, second.id);
        const smoothDown = await capture(
          page,
          second.id,
          `${label}-smooth-down-uncorrected`,
          testInfo,
        );
        assertLayout(smoothDown.bounds, smoothDown.native);
        await navigate(page, first.id, "ArrowUp");
        await pauseDecodedFrame(page, first.id);
        const smoothUp = await capture(page, first.id, `${label}-smooth-up-uncorrected`, testInfo);
        assertLayout(smoothUp.bounds, smoothUp.native);
      }
      if (locale === "ar" && viewport.width === 390)
        await longDescription(page, first.id, testInfo);
    });
  }
}
