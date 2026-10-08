import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
interface Catalog {
  fixtureId: string;
  email: string;
  password: string;
  videos: { id: string; slug: string }[];
}
function fixture<T = { ok: boolean }>(command: string, input: object = {}): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/clips-audience-fixture.mjs"), command, JSON.stringify(input)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
const active = (page: Page) => page.locator("[data-clip-active='true']");
const video = (page: Page) => active(page).locator("video");
async function open(
  page: Page,
  catalog: Catalog,
  available: () => boolean = () => true,
  locale: "en" | "ar" = "en",
) {
  expect(
    (
      await page.request.post(`${API}/auth/login`, {
        headers: { origin: WEB },
        data: { email: catalog.email, password: catalog.password },
      })
    ).status(),
  ).toBe(200);
  const bytes = readFileSync(path.resolve("tests/e2e/fixtures/clips-viewport.webm"));
  await page.route("**/e2e/clips-audience/**/canonical.mp4", async (route) => {
    if (!available()) return route.abort("internetdisconnected");
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
  await page.goto("/clips?lang=" + locale);
  await expect
    .poll(() =>
      video(page).evaluate(
        (node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames,
      ),
    )
    .toBeGreaterThan(0);
}
async function playing(page: Page, value: boolean) {
  await expect
    .poll(() => video(page).evaluate((node: HTMLVideoElement) => !node.paused))
    .toBe(value);
}
async function capture(page: Page, testInfo: TestInfo, name: string) {
  const output = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: output, fullPage: false, animations: "disabled" });
  await testInfo.attach(name, { path: output, contentType: "image/png" });
}
test.use({
  serviceWorkers: "block",
  contextOptions: { reducedMotion: "no-preference" },
  viewport: { width: 390, height: 844 },
});

for (const { locale, scale } of [
  { locale: "en", scale: 1 },
  { locale: "en", scale: 2 },
  { locale: "ar", scale: 1 },
  { locale: "ar", scale: 2 },
] as const) {
  test(`${locale} 320px authored control reflow at ${scale * 100}% text size`, async ({
    page,
  }, testInfo) => {
    const catalog = fixture<Catalog>("seed", { longText: true });
    try {
      await page.setViewportSize({ width: 320, height: 844 });
      await open(page, catalog, () => true, locale);
      if (scale === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      await capture(page, testInfo, `clips-320-${locale}-text-${scale * 100}`);
      const viewport = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
      }));
      expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth + 1);
      const headerControls = page.locator(
        '[data-ayin-shell-header] [data-tv-focus-id="brand-home"], [data-ayin-shell-header] [data-tv-focus-id="create-upload"], [data-ayin-shell-header] button[aria-haspopup="dialog"]',
      );
      await expect(headerControls).toHaveCount(3);
      for (const control of await headerControls.all()) {
        await control.focus();
        const state = await control.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            label: node.getAttribute("aria-label") ?? node.textContent,
            left: box.left,
            right: box.right,
            width: box.width,
            height: box.height,
            focused: document.activeElement === node,
            hit: !!hit && (hit === node || node.contains(hit)),
          };
        });
        expect(state.focused, state.label ?? "header control").toBe(true);
        expect(state.hit, state.label ?? "header control").toBe(true);
        expect(state.left).toBeGreaterThanOrEqual(-1);
        expect(state.right).toBeLessThanOrEqual(viewport.innerWidth + 1);
        expect(state.width).toBeGreaterThanOrEqual(44);
        expect(state.height).toBeGreaterThanOrEqual(44);
      }
      const controls = active(page).locator("[data-clip-player] button, [data-clip-player] input");
      for (const control of await controls.all()) {
        await control.focus();
        const state = await control.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const parent = node.closest("[data-clip-player]")!.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            label: node.getAttribute("aria-label"),
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
            parentTop: parent.top,
            parentBottom: parent.bottom,
            focused: document.activeElement === node,
            hit: !!hit && (hit === node || node.contains(hit)),
          };
        });
        expect(state.focused, state.label ?? "control").toBe(true);
        expect(state.hit, state.label ?? "control").toBe(true);
        expect(state.left).toBeGreaterThanOrEqual(-1);
        expect(state.right).toBeLessThanOrEqual(321);
        expect(state.top).toBeGreaterThanOrEqual(state.parentTop - 1);
        expect(state.bottom).toBeLessThanOrEqual(state.parentBottom + 1);
        expect(state.width).toBeGreaterThanOrEqual(44);
        expect(state.height).toBeGreaterThanOrEqual(44);
      }
      await testInfo.attach("text-enlargement-method", {
        body: `Viewport 320×844; root font size ${scale * 100}%. This verifies CSS text enlargement, not physical browser pinch zoom or assistive-device behavior.`,
        contentType: "text/plain",
      });
    } finally {
      fixture("cleanup", { fixtureId: catalog.fixtureId });
    }
  });
}

test("reduced-motion changes during automatic playback pause immediately without losing explicit Play", async ({
  page,
}) => {
  const catalog = fixture<Catalog>("seed");
  try {
    await open(page, catalog);
    await playing(page, true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await playing(page, false);
    await expect(active(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await active(page).getByRole("button", { name: "Play", exact: true }).click();
    await playing(page, true);
    await active(page).getByRole("button", { name: "Pause", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await playing(page, false);
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

test("an already-open external dialog inserted then removed pauses and restores the same Clip", async ({
  page,
}) => {
  const catalog = fixture<Catalog>("seed");
  try {
    await open(page, catalog);
    const id = await active(page).getAttribute("data-video-id");
    await page.evaluate(() => {
      const dialog = document.createElement("dialog");
      dialog.id = "clips-external-dialog-fixture";
      dialog.open = true;
      dialog.setAttribute("aria-label", "External feature dialog");
      dialog.textContent = "Synthetic dialog lifecycle fixture";
      document.body.append(dialog);
    });
    await playing(page, false);
    const position = await video(page).evaluate((node: HTMLVideoElement) => node.currentTime);
    await page.evaluate(() => document.getElementById("clips-external-dialog-fixture")!.remove());
    await playing(page, true);
    await expect(active(page)).toHaveAttribute("data-video-id", id!);
    expect(
      await video(page).evaluate((node: HTMLVideoElement) => node.currentTime),
    ).toBeGreaterThanOrEqual(position);
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

for (const mode of ["clipboard-denied", "native-cancelled"] as const) {
  test(`sharing ${mode} is truthful and recoverable`, async ({ page }) => {
    const catalog = fixture<Catalog>("seed");
    try {
      await page.addInitScript((mode) => {
        const calls: string[] = [];
        Object.assign(window, { clipsShareCalls: calls });
        if (mode === "clipboard-denied") {
          Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (value: string) => {
                calls.push(value);
                throw new DOMException("Controlled clipboard denial", "NotAllowedError");
              },
            },
          });
        } else {
          Object.defineProperty(navigator, "share", {
            configurable: true,
            value: (data: { url: string }) => {
              calls.push(data.url);
              return new Promise<void>((_, reject) => {
                Object.assign(window, {
                  cancelClipShare: () =>
                    reject(new DOMException("Controlled native cancellation", "AbortError")),
                });
              });
            },
          });
        }
      }, mode);
      await open(page, catalog);
      await active(page).getByRole("button", { name: "Share", exact: true }).click();
      if (mode === "native-cancelled") {
        await playing(page, false);
        await page.evaluate(() =>
          (window as unknown as { cancelClipShare: () => void }).cancelClipShare(),
        );
        await expect(
          active(page).getByText(
            "The link could not be shared. Open in Watch and copy its address.",
            { exact: true },
          ),
        ).toHaveCount(0);
      } else {
        await expect(
          active(page).getByText(
            "The link could not be shared. Open in Watch and copy its address.",
            { exact: true },
          ),
        ).toBeVisible();
      }
      await expect(active(page).getByText("Link copied.", { exact: true })).toHaveCount(0);
      await expect(active(page).getByText("Share sheet completed.", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        active(page).getByRole("link", { name: "Open in Watch", exact: true }),
      ).toHaveAttribute("href", /\/watch\//);
      const calls = await page.evaluate(
        () => (window as unknown as { clipsShareCalls: string[] }).clipsShareCalls,
      );
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0]!).pathname).toMatch(/^\/watch\//);
      expect(new URL(calls[0]!).search).toBe("");
      await playing(page, true);
    } finally {
      fixture("cleanup", { fixtureId: catalog.fixtureId });
    }
  });
}

test("offline media failure keeps the selected Clip and a reconnect retry decodes successfully", async ({
  page,
  context,
}) => {
  const catalog = fixture<Catalog>("seed");
  let online = true;
  try {
    await open(page, catalog, () => online);
    online = false;
    await context.setOffline(true);
    await page.getByRole("button", { name: "Next Clip", exact: true }).click();
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[1]!.id);
    await expect(
      active(page).getByRole("button", { name: "Retry video", exact: true }),
    ).toBeVisible();
    await expect(
      active(page).getByText("This video couldn’t load.", { exact: false }),
    ).toBeVisible();
    await playing(page, false);
    online = true;
    await context.setOffline(false);
    await active(page).getByRole("button", { name: "Retry video", exact: true }).click();
    await expect
      .poll(() =>
        video(page).evaluate(
          (node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames,
        ),
      )
      .toBeGreaterThan(0);
    await playing(page, true);
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[1]!.id);
    await expect(page.locator("video")).toHaveCount(1);
  } finally {
    await context.setOffline(false);
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

for (const failure of [
  { status: 401, code: "AUTH_REQUIRED" },
  { status: 409, code: "ACCOUNT_CHANGED" },
  { status: 409, code: "PLAYBACK_VIEWER_CHANGED" },
]) {
  test(`capability ${failure.status} ${failure.code} revokes old media once and requires explicit retry`, async ({
    page,
  }) => {
    const catalog = fixture<Catalog>("seed");
    let releaseCapability!: () => void;
    const capabilityGate = new Promise<void>((resolve) => {
      releaseCapability = resolve;
    });
    let releaseIdentity!: () => void;
    const identityGate = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    let releaseSocial!: () => void;
    const socialGate = new Promise<void>((resolve) => {
      releaseSocial = resolve;
    });
    let reads = 0;
    let holdIdentity = false;
    let identityHeld = false;
    try {
      await page.route(`${API}/social/**`, async (route) => {
        if (route.request().method() === "GET") await socialGate;
        await route.continue().catch(() => undefined);
      });
      await page.route(`${API}/auth/me`, async (route) => {
        if (!holdIdentity || identityHeld) return route.continue();
        const actual = await route.fetch();
        expect(actual.status()).toBe(200);
        identityHeld = true;
        await identityGate;
        await route.fulfill({ response: actual }).catch(() => undefined);
      });
      await page.route(
        `${API}/public/videos/${catalog.videos[0]!.slug}/playback?*`,
        async (route) => {
          reads++;
          if (reads > 1) return route.continue();
          await capabilityGate;
          await route.fulfill({
            status: failure.status,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: failure.code,
                message: "Controlled server-classified identity failure",
              },
            }),
          });
        },
      );
      await open(page, catalog);
      await expect.poll(() => reads).toBe(1);
      const retired = await video(page).elementHandle();
      holdIdentity = true;
      releaseCapability();
      await expect.poll(() => identityHeld).toBe(true);
      await expect(page.locator("[data-clip-item]:visible")).toHaveCount(0);
      expect(
        await retired!.evaluate(
          (node: HTMLVideoElement) => node.paused && !node.hasAttribute("src"),
        ),
      ).toBe(true);
      releaseIdentity();
      releaseSocial();
      await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
      await page.waitForTimeout(300);
      expect(reads).toBe(1);
      await active(page).getByRole("button", { name: "Details", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Details", exact: true });
      await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Try again", exact: true }).click();
      await expect.poll(() => reads).toBe(2);
      await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
      await page.waitForTimeout(200);
      expect(reads).toBe(2);
      await retired!.dispose();
    } finally {
      releaseCapability();
      releaseIdentity();
      releaseSocial();
      fixture("cleanup", { fixtureId: catalog.fixtureId });
    }
  });
}

test("ordinary VIDEO_NOT_PLAYABLE capability409 stays unavailable without an identity retry loop", async ({
  page,
}) => {
  const catalog = fixture<Catalog>("seed");
  let capabilityReads = 0;
  let identityReads = 0;
  try {
    page.on("request", (request) => {
      if (request.url() === `${API}/auth/me`) identityReads++;
    });
    await page.route(
      `${API}/public/videos/${catalog.videos[0]!.slug}/playback?*`,
      async (route) => {
        capabilityReads++;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "VIDEO_NOT_PLAYABLE",
              message: "Controlled unavailable optional detail",
            },
          }),
        });
      },
    );
    await open(page, catalog);
    const identityBefore = identityReads;
    const retained = await video(page).elementHandle();
    await active(page).getByRole("button", { name: "Details", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Details", exact: true });
    await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    expect(capabilityReads).toBe(1);
    expect(identityReads).toBe(identityBefore);
    expect(
      await retained!.evaluate(
        (node: HTMLVideoElement) => node.isConnected && node.hasAttribute("src"),
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await playing(page, true);
    await retained!.dispose();
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

for (const locale of ["en", "ar"] as const) {
  test(`short landscape at 200% text keeps decoded media and keyboard controls usable ${locale}`, async ({
    page,
  }, testInfo) => {
    const catalog = fixture<Catalog>("seed", { longText: true });
    try {
      await page.setViewportSize({ width: 844, height: 390 });
      await open(page, catalog);
      if (locale === "ar") {
        await page.goto("/ar/clips?lang=ar");
        await expect
          .poll(() =>
            video(page).evaluate(
              (node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames,
            ),
          )
          .toBeGreaterThan(0);
      }
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      await capture(page, testInfo, `clips-landscape-844-text-200-${locale}`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const mediaBox = await video(page).boundingBox();
      expect(mediaBox!.height).toBeGreaterThan(40);
      expect(mediaBox!.width).toBeGreaterThan(40);
      const states = [];
      for (const control of await active(page)
        .locator("[data-clip-player] button, [data-clip-player] input")
        .all()) {
        // At extreme text enlargement ordinary document scrolling is allowed;
        // focus must still reveal each complete, usable authored control.
        await control.focus();
        // Browser focus scrolling can settle after focus() returns. Observe
        // that native result instead of manually repairing its scroll position.
        await expect
          .poll(() =>
            control.evaluate((node) => {
              const box = node.getBoundingClientRect();
              const hit = document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
              return !!hit && (hit === node || node.contains(hit));
            }),
          )
          .toBe(true);
        const state = await control.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return {
            label: node.getAttribute("aria-label"),
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            focused: document.activeElement === node,
            hit: !!hit && (hit === node || node.contains(hit)),
          };
        });
        states.push(state);
        expect(state.focused, state.label ?? "control").toBe(true);
        expect(state.hit, state.label ?? "control").toBe(true);
        expect(state.left).toBeGreaterThanOrEqual(-1);
        expect(state.right).toBeLessThanOrEqual(845);
        expect(state.top).toBeGreaterThanOrEqual(-1);
        expect(state.bottom).toBeLessThanOrEqual(391);
        expect(state.width).toBeGreaterThanOrEqual(44);
        expect(state.height).toBeGreaterThanOrEqual(44);
      }
      await testInfo.attach(`landscape-text-enlargement-${locale}`, {
        body: JSON.stringify({
          mediaBox,
          controls: states,
          method: "200% root font size, not physical browser pinch zoom",
        }),
        contentType: "application/json",
      });
    } finally {
      fixture("cleanup", { fixtureId: catalog.fixtureId });
    }
  });
}

test("a valid same-video200 with a newer source and newly Kids audience conceals adult cards and revalidates a Kids-only feed", async ({
  page,
}) => {
  const catalog = fixture<Catalog>("seed");
  let releaseCapability!: () => void;
  const capabilityGate = new Promise<void>((resolve) => {
    releaseCapability = resolve;
  });
  let releaseIdentity!: () => void;
  const identityGate = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });
  let releaseSocial!: () => void;
  const socialGate = new Promise<void>((resolve) => {
    releaseSocial = resolve;
  });
  let capabilityHeld = false;
  let holdIdentity = false;
  let identityHeld = false;
  let narrowerResponse: { id: string; isKids: boolean } | null = null;
  try {
    await page.route(`${API}/social/**`, async (route) => {
      if (route.request().method() === "GET") await socialGate;
      await route.continue().catch(() => undefined);
    });
    await page.route(`${API}/auth/me`, async (route) => {
      if (!holdIdentity || identityHeld) return route.continue();
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      identityHeld = true;
      await identityGate;
      await route.fulfill({ response: actual }).catch(() => undefined);
    });
    await page.route(
      `${API}/public/videos/${catalog.videos[1]!.slug}/playback?*`,
      async (route) => {
        if (capabilityHeld) return route.continue();
        capabilityHeld = true;
        await capabilityGate;
        // The actual isolated API reads the same profile after its kind changed.
        // This eligible video remains the same while its source and audience
        // change. The response body is not fabricated or rewritten.
        const actual = await route.fetch();
        expect(actual.status()).toBe(200);
        const body = await actual.json();
        narrowerResponse = { id: body.video.id, isKids: body.viewer.isKids };
        expect(narrowerResponse).toEqual({ id: catalog.videos[1]!.id, isKids: true });
        expect(body.video.source.objectKey).toContain("/refreshed/canonical.mp4");
        await route.fulfill({ response: actual });
      },
    );
    await open(page, catalog);
    await page.getByRole("button", { name: "Next Clip", exact: true }).click();
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[1]!.id);
    await expect.poll(() => capabilityHeld).toBe(true);
    const retired = await video(page).elementHandle();
    await expect(
      page.locator(`[data-clip-item][data-video-id="${catalog.videos[0]!.id}"]`),
    ).toHaveCount(1);
    fixture("default-kids", { fixtureId: catalog.fixtureId, isKids: true });
    fixture("refresh-source", {
      fixtureId: catalog.fixtureId,
      videoId: catalog.videos[1]!.id,
    });
    holdIdentity = true;
    releaseCapability();
    await expect.poll(() => identityHeld).toBe(true);
    await expect(page.locator("[data-clip-item]:visible")).toHaveCount(0);
    expect(
      await retired!.evaluate((node: HTMLVideoElement) => node.paused && !node.hasAttribute("src")),
    ).toBe(true);
    releaseIdentity();
    releaseSocial();
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[1]!.id);
    await expect(active(page)).toHaveAttribute("data-clip-index", "0");
    await expect(
      page.locator(`[data-clip-item][data-video-id="${catalog.videos[0]!.id}"]`),
    ).toHaveCount(0);
    await expect(page.locator("[data-clips-feed]")).toHaveAttribute(
      "data-clips-loaded-count",
      "20",
    );
    expect(narrowerResponse).toEqual({ id: catalog.videos[1]!.id, isKids: true });
    await retired!.dispose();
  } finally {
    releaseCapability();
    releaseIdentity();
    releaseSocial();
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

async function seekRange(page: Page, seconds: number) {
  await active(page)
    .getByRole("slider", { name: "Playback position", exact: true })
    .evaluate((node: HTMLInputElement, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        node,
        String(value),
      );
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, seconds);
}
async function recordEnds(page: Page) {
  await page.evaluate(() => {
    const events: { id: string | null; time: number }[] = [];
    Object.assign(window, { clipsDecodedEnds: events });
    document.addEventListener(
      "ended",
      (event) => {
        const media = event.target as HTMLVideoElement;
        events.push({
          id: media.closest("[data-video-id]")?.getAttribute("data-video-id") ?? null,
          time: media.currentTime,
        });
      },
      true,
    );
  });
}
async function endedEvents(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { clipsDecodedEnds: { id: string | null; time: number }[] })
        .clipsDecodedEnds,
  );
}
async function finishDecodedClip(page: Page) {
  const duration = await video(page).evaluate((node: HTMLVideoElement) => node.duration);
  await seekRange(page, duration - 0.2);
  await expect.poll(() => video(page).evaluate((node: HTMLVideoElement) => node.ended)).toBe(true);
  await expect.poll(async () => (await endedEvents(page)).length).toBe(1);
}

test("decoded completion followed by Next and Previous starts a new replay at zero without another tail completion", async ({
  page,
}, testInfo) => {
  const catalog = fixture<Catalog>("seed");
  try {
    await open(page, catalog);
    await recordEnds(page);
    await finishDecodedClip(page);
    await page.getByRole("button", { name: "Next Clip", exact: true }).click();
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[1]!.id);
    await playing(page, true);
    await page.getByRole("button", { name: "Previous Clip", exact: true }).click();
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
    await playing(page, true);
    expect(await video(page).evaluate((node: HTMLVideoElement) => node.currentTime)).toBeLessThan(
      3,
    );
    await page.waitForTimeout(600);
    expect(await video(page).evaluate((node: HTMLVideoElement) => node.ended)).toBe(false);
    expect(await endedEvents(page)).toHaveLength(1);
    await testInfo.attach("decoded-completion-return", {
      body: JSON.stringify(await endedEvents(page)),
      contentType: "application/json",
    });
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

for (const intent of ["authored-play", "native-play", "explicit-seek"] as const) {
  test(`decoded ended focus restoration stays paused and honors ${intent} without a duplicate completion`, async ({
    page,
  }, testInfo) => {
    const catalog = fixture<Catalog>("seed");
    try {
      await open(page, catalog);
      await recordEnds(page);
      await finishDecodedClip(page);
      const id = catalog.videos[0]!.id;
      const retired = await video(page).elementHandle();
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(active(page)).toHaveAttribute("data-video-id", id);
      await expect
        .poll(() => video(page).evaluate((node: HTMLVideoElement) => node.readyState))
        .toBeGreaterThanOrEqual(2);
      await playing(page, false);
      await page.waitForTimeout(400);
      expect(await endedEvents(page)).toHaveLength(1);
      expect(
        await retired!.evaluate(
          (node: HTMLVideoElement) => node.paused && !node.hasAttribute("src"),
        ),
      ).toBe(true);
      await retired!.dispose();
      if (intent === "native-play") {
        await active(page).locator(`[data-tv-focus-id="clip-${id}-native"]`).click();
        await expect(video(page)).toHaveAttribute("controls", "");
        await video(page).focus();
        await page.keyboard.press("Space");
      } else {
        if (intent === "explicit-seek") {
          await seekRange(page, 7);
          await expect
            .poll(() => video(page).evaluate((node: HTMLVideoElement) => node.currentTime))
            .toBe(7);
        }
        await active(page).locator(`[data-tv-focus-id="clip-${id}-play"]`).click();
      }
      await playing(page, true);
      const time = await video(page).evaluate((node: HTMLVideoElement) => node.currentTime);
      if (intent === "explicit-seek") {
        expect(time).toBeGreaterThanOrEqual(7);
        expect(time).toBeLessThan(10);
      } else expect(time).toBeLessThan(3);
      await page.waitForTimeout(600);
      expect(await endedEvents(page)).toHaveLength(1);
      await testInfo.attach(`decoded-ended-${intent}`, {
        body: JSON.stringify({ time, endedEvents: await endedEvents(page) }),
        contentType: "application/json",
      });
    } finally {
      fixture("cleanup", { fixtureId: catalog.fixtureId });
    }
  });
}
