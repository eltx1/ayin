import { expect, test } from "@playwright/test";

// These are deterministic UI events. Actual SW/cache/update behavior has its own PWA gate.
test.use({ serviceWorkers: "block" });

for (const locale of ["en", "ar"]) {
  test(`global feedback clears measured navigation and native modal focus in ${locale}`, async ({
    page,
  }, info) => {
    const prefix = locale === "ar" ? "/ar" : "";
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto(`${prefix}/search?lang=${locale}`);
      await page.bringToFront();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("[data-private-viewer-identity]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        Object.assign(event, {
          prompt: async () => {},
          userChoice: Promise.resolve({ outcome: "dismissed" }),
        });
        window.dispatchEvent(event);
        window.dispatchEvent(new Event("offline"));
      });
      const dock = page.locator("[data-ayin-feedback-dock]");
      const later = dock.getByRole("button", {
        name: locale === "ar" ? "ليس الآن" : "Not now",
        exact: true,
      });
      await expect(later).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const nav = document
              .querySelector("[data-ayin-bottom-navigation]")!
              .getBoundingClientRect();
            const dock = document
              .querySelector("[data-ayin-feedback-dock]")!
              .getBoundingClientRect();
            return (
              Math.abs(parseFloat(root.getPropertyValue("--ayin-shell-bottom")) - nav.height) < 1 &&
              (nav.height === 0 || dock.bottom < nav.top) &&
              dock.top >= 0 &&
              dock.bottom <= innerHeight
            );
          }),
        )
        .toBe(true);
      const controls = await dock.getByRole("button").evaluateAll((buttons) =>
        buttons.map((button) => {
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { width: r.width, height: r.height, hit: button === hit || button.contains(hit) };
        }),
      );
      for (const control of controls) {
        expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.hit).toBe(true);
      }
      await page.screenshot({ path: info.outputPath(`feedback-${locale}-${width}.png`) });
      const lastLegalLink = page.locator("footer nav a").last();
      await lastLegalLink.focus();
      await lastLegalLink.scrollIntoViewIfNeeded();
      await page.evaluate(() =>
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
      );
      expect(
        await lastLegalLink.evaluate((node) => {
          const r = node.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return node === hit || node.contains(hit);
        }),
      ).toBe(true);
      const menu = page.getByRole("button", {
        name: locale === "ar" ? "فتح القائمة" : "Open menu",
        exact: true,
      });
      await menu.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await later.click();
      await expect(later).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(dock).toBeHidden({ timeout: 6000 });
    }
  });
}

test("200% text and short landscape keep mobile navigation labels and targets reachable", async ({
  page,
}, info) => {
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/ar/browse?lang=ar");
    await page.bringToFront();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const links = page.locator("[data-ayin-bottom-navigation] a");
    await expect(links.first()).toBeVisible();
    for (const link of await links.all()) {
      const geometry = await link.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(node.querySelector("span")!);
        return {
          width: box.width,
          height: box.height,
          contained: Array.from(range.getClientRects()).every(
            (r) => r.left >= box.left - 1 && r.right <= box.right + 1,
          ),
          visible: box.top >= 0 && box.bottom <= innerHeight + 1,
        };
      });
      expect(geometry.width).toBeGreaterThanOrEqual(44);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.contained).toBe(true);
      expect(geometry.visible).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`reflow-ar-${viewport.width}.png`) });
  }
});

test("keyboard-sized visual viewport bounds the feedback dock and native navigation dialog", async ({
  page,
}, info) => {
  // Geometry simulation, not a physical-device keyboard or installed-PWA claim.
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      height: 844,
      width: 390,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/search?lang=en");
  await page.bringToFront();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-private-viewer-identity]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
    window.dispatchEvent(new Event("offline"));
    Object.assign(window.visualViewport!, { height: 400, offsetTop: 40 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  const later = page.getByRole("button", { name: "Not now", exact: true });
  await expect(later).toBeVisible();
  await later.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.locator("[data-ayin-feedback-dock]").evaluate((node) => {
        const r = node.getBoundingClientRect();
        return r.top >= 40 && r.bottom <= 440;
      }),
    )
    .toBe(true);
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  await menu.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(40);
  expect(box!.y + box!.height).toBeLessThanOrEqual(440);
  await page.screenshot({ path: info.outputPath("keyboard-geometry-390-200percent.png") });
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 844, offsetTop: 0 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await later.scrollIntoViewIfNeeded();
  await later.click();
  await expect(later).toHaveCount(0);
});
