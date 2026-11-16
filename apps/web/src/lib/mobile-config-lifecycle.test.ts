import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const port = vi.hoisted(() => ({ apply: vi.fn(), refresh: vi.fn(), ready: true, host: true }));
vi.mock("./mobile-runtime", () => ({
  applyPendingMobileConfig: port.apply,
  refreshMobileConfig: port.refresh,
  getMobileState: () => ({ ready: port.ready }),
}));
vi.mock("./mobile-bridge", () => ({ isMobileHost: () => port.host }));
import { installMobileConfigLifecycle } from "./mobile-config-lifecycle";
let host: EventTarget, page: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  port.apply.mockReset();
  port.refresh.mockReset();
  port.ready = true;
  port.host = true;
  host = new EventTarget();
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", page);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("foreground mobile config lifecycle", () => {
  it("polls network at bounded intervals while independently retrying safe activation", async () => {
    const abort = new AbortController(),
      stop = installMobileConfigLifecycle(abort.signal);
    await vi.advanceTimersByTimeAsync(290000);
    expect(port.refresh).not.toHaveBeenCalled();
    expect(port.apply).toHaveBeenCalledTimes(29);
    await vi.advanceTimersByTimeAsync(10000);
    expect(port.refresh).toHaveBeenCalledOnce();
    stop();
    await vi.advanceTimersByTimeAsync(600000);
    expect(port.refresh).toHaveBeenCalledOnce();
  });
  it("refreshes on resume after 30 seconds but ignores repeated focus and hidden pages", async () => {
    const abort = new AbortController();
    installMobileConfigLifecycle(abort.signal);
    host.dispatchEvent(new Event("focus"));
    expect(port.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    page.visibilityState = "hidden";
    host.dispatchEvent(new Event("focus"));
    expect(port.refresh).not.toHaveBeenCalled();
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    host.dispatchEvent(new Event("focus"));
    expect(port.refresh).toHaveBeenCalledOnce();
    abort.abort();
    await vi.advanceTimersByTimeAsync(600000);
    page.dispatchEvent(new Event("visibilitychange"));
    expect(port.refresh).toHaveBeenCalledOnce();
  });
  it("does nothing for browser/PWA or an uninitialized shell", async () => {
    const abort = new AbortController();
    installMobileConfigLifecycle(abort.signal);
    port.host = false;
    await vi.advanceTimersByTimeAsync(300000);
    port.host = true;
    port.ready = false;
    await vi.advanceTimersByTimeAsync(300000);
    expect(port.apply).not.toHaveBeenCalled();
    expect(port.refresh).not.toHaveBeenCalled();
    abort.abort();
  });
});
