import { afterEach, expect, it, vi } from "vitest";
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (fn: () => unknown) => fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/ar/watch/private-slug" }));
import { WebAnalytics } from "./web-analytics";

afterEach(() => vi.unstubAllGlobals());

it("requires browser consent, excludes native shells and removes content identifiers", () => {
  const getItem = vi.fn(() => "no");
  const host = Object.assign(new EventTarget(), {
    location: { hostname: "ayin.stream", origin: "https://ayin.stream" },
    AyinNative: undefined as object | undefined,
    localStorage: { getItem },
    dataLayer: [] as Array<ArrayLike<unknown>>,
  });
  const appendChild = vi.fn();
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", { createElement: () => ({}), head: { appendChild } });
  WebAnalytics();
  expect(appendChild).not.toHaveBeenCalled();
  host.AyinNative = {};
  getItem.mockReturnValue("yes");
  WebAnalytics();
  expect(appendChild).not.toHaveBeenCalled();
  host.AyinNative = undefined;
  host.dispatchEvent(new Event("ayin:web-analytics-preference"));
  expect(appendChild).toHaveBeenCalledOnce();
  expect(Array.from(host.dataLayer.at(-1)!)).toEqual([
    "event",
    "page_view",
    {
      page_location: "https://ayin.stream/watch",
      page_title: "watch",
      page_referrer: "",
    },
  ]);
  const commands = host.dataLayer.length;
  getItem.mockReturnValue("no");
  host.dispatchEvent(new Event("ayin:web-analytics-preference"));
  expect(host.dataLayer).toHaveLength(commands);
  expect(window["ga-disable-G-0ZC4Y6Z8PJ"]).toBe(true);
});
