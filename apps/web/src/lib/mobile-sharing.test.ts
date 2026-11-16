import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ request: vi.fn(), supports: vi.fn() }));
vi.mock("./mobile-bridge", async (original) => ({
  ...(await original<typeof import("./mobile-bridge")>()),
  requestMobile: bridge.request,
  supportsMobile: bridge.supports,
}));
import { sharePublicUrl } from "./mobile-sharing";
import { validMobileRequest, validMobileShareUrl } from "./mobile-bridge";
let browserShare: ReturnType<typeof vi.fn>, clipboard: ReturnType<typeof vi.fn>;
beforeEach(() => {
  bridge.request.mockReset();
  bridge.supports.mockReturnValue(true);
  browserShare = vi.fn();
  clipboard = vi.fn();
  vi.stubGlobal("window", { location: { origin: "https://ayin.stream" } });
  vi.stubGlobal("navigator", { share: browserShare, clipboard: { writeText: clipboard } });
});
afterEach(() => vi.unstubAllGlobals());
describe("finite public mobile sharing", () => {
  it.each(["https://me:secret@ayin.stream/watch/a", "https://evil.example/watch/a", "/account"])(
    "does not share private or external input %s",
    async (url) => {
      expect(await sharePublicUrl(url)).toBe(false);
      expect(bridge.request).not.toHaveBeenCalled();
      expect(browserShare).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();
    },
  );
  it.each(["/watch/a", "/ar/c/channel?kids=1&lang=ar", "/clips", "/live/now", "/playlists/list"])(
    "accepts public destination %s",
    (path) => {
      expect(validMobileShareUrl("https://ayin.stream" + path)).toBe(true);
    },
  );
  it.each([
    "https://evil.example/watch/a",
    "https://me:secret@ayin.stream/watch/a",
    "https://ayin.stream/account",
    "https://ayin.stream/watch/a#token",
    "https://ayin.stream/watch/a?token=secret",
    "https://ayin.stream/watch/a?lang=en&lang=ar",
  ])("rejects unsafe raw bridge destination %s", (url) => {
    expect(validMobileRequest("share.open", { url })).toBe(false);
  });
  it("strips private query/fragments before invoking one native sheet", async () => {
    bridge.request.mockResolvedValue({ shared: true });
    expect(await sharePublicUrl("/watch/a?token=secret&kids=1&lang=ar#private")).toBe(true);
    expect(bridge.request).toHaveBeenCalledExactlyOnceWith("share.open", {
      url: "https://ayin.stream/watch/a?kids=1&lang=ar",
    });
    expect(browserShare).not.toHaveBeenCalled();
    expect(clipboard).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "failed"])("never opens a second dialog after native %s", async (kind) => {
    if (kind === "cancelled") bridge.request.mockResolvedValue({ shared: false });
    else bridge.request.mockRejectedValue(new Error("cancel"));
    expect(await sharePublicUrl("/watch/a")).toBe(false);
    expect(browserShare).not.toHaveBeenCalled();
    expect(clipboard).not.toHaveBeenCalled();
  });
  it("uses ordinary browser sharing when no native share capability exists", async () => {
    bridge.supports.mockReturnValue(false);
    expect(await sharePublicUrl("/watch/a")).toBe(true);
    expect(browserShare).toHaveBeenCalledWith({ url: "https://ayin.stream/watch/a" });
    expect(bridge.request).not.toHaveBeenCalled();
  });
  it("rejects arbitrary file clearing parameters", () => {
    expect(validMobileRequest("upload.clear", {})).toBe(true);
    expect(validMobileRequest("upload.clear", { path: "/private" })).toBe(false);
    expect(validMobileRequest("media.pip", { url: "https://evil.example" })).toBe(false);
  });
});
