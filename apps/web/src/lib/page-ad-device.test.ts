import { afterEach, expect, it, vi } from "vitest";

import { detectPageAdDevice, subscribePageAdDevice } from "./page-ads";

afterEach(() => vi.unstubAllGlobals());

it("rechecks mobile/desktop/TV categories on resize and pointer changes, and unsubscribes", () => {
  const viewport = new EventTarget();
  const query = Object.assign(new EventTarget(), { matches: false });
  const windowStub = Object.assign(viewport, { innerWidth: 1100, matchMedia: () => query });
  vi.stubGlobal("window", windowStub);
  const readings: string[] = [];
  const unsubscribe = subscribePageAdDevice(() => readings.push(detectPageAdDevice()));
  expect(detectPageAdDevice()).toBe("DESKTOP");
  windowStub.innerWidth = 390;
  viewport.dispatchEvent(new Event("resize"));
  windowStub.innerWidth = 1400;
  viewport.dispatchEvent(new Event("resize"));
  query.matches = true;
  query.dispatchEvent(new Event("change"));
  expect(readings).toEqual(["MOBILE", "DESKTOP", "TV"]);
  unsubscribe();
  viewport.dispatchEvent(new Event("resize"));
  query.dispatchEvent(new Event("change"));
  expect(readings).toHaveLength(3);
});
