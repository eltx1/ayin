import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type * as MobileBridge from "./mobile-bridge";

const native = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./mobile-bridge", async (original) => ({
  ...(await original<typeof MobileBridge>()),
  requestMobile: native.request,
  supportsMobile: () => true,
  isMobileHost: () => true,
}));
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
const consentKey = "ayin.mobile.analytics.consent.v1:";
let identity: string, config: Record<string, unknown>, storage: Map<string, string>;
const info = {
  platform: "ios",
  appVersion: "1.1.0",
  installationId: "33333333-3333-4333-8333-333333333333",
  boundAccountId: accountA,
  configured: { firebase: true, ads: false },
};
beforeEach(() => {
  vi.resetModules();
  native.request.mockReset();
  native.request.mockImplementation(async (method: string) =>
    method === "runtime.configure" ? info : {},
  );
  identity = accountA;
  config = JSON.parse(readFileSync("../../docs/MOBILE_RUNTIME_CONTRACT.json", "utf8"));
  config = {
    ...config,
    analytics: { enabled: true },
    ads: { ...(config.ads as object), audience: "general" },
  };
  storage = new Map([
    ["ayin.mobile.adult.v1:" + accountA, "yes"],
    ["ayin.mobile.adult.v1:" + accountB, "yes"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("window", { location: { pathname: "/", search: "" } });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    documentElement: { dataset: {} },
    querySelectorAll: () => [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/mobile/config")) return Response.json(config);
      if (url.endsWith("/auth/me"))
        return Response.json({ account: { id: identity }, profile: { isKids: false } });
      return new Response(null, { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function boot() {
  const runtime = await import("./mobile-runtime");
  await runtime.initializeMobile(new AbortController().signal);
  return runtime;
}
function delayNextEnable() {
  let finish!: () => void;
  native.request.mockImplementation(async (method: string, params?: { enabled?: boolean }) => {
    if (method === "runtime.configure") return info;
    if (method === "analytics.consent" && params?.enabled)
      return new Promise<{ enabled: boolean }>((resolve) => {
        finish = () => resolve({ enabled: true });
      });
    return {};
  });
  return { finish: () => finish(), started: () => typeof finish === "function" };
}
describe("analytics consent account and withdrawal races (bridge mocks, not SDK proof)", () => {
  it("never applies account A's delayed enable to account B or B's stored consent", async () => {
    const runtime = await boot(),
      delayed = delayNextEnable();
    const enabling = runtime.setMobileAnalyticsConsent(true).catch((error: Error) => error.message);
    await vi.waitFor(() => expect(delayed.started()).toBe(true));
    identity = accountB;
    const switched = runtime.refreshMobileAccount();
    delayed.finish();
    expect(await enabling).toBe("ANALYTICS_INTERRUPTED");
    await switched;
    expect(runtime.getMobileAccountId()).toBe(accountB);
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    expect(storage.get(consentKey + accountA)).not.toBe("yes");
    expect(storage.get(consentKey + accountB)).not.toBe("yes");
    expect(native.request).not.toHaveBeenCalledWith("analytics.user", { id: accountB });
  });
  it("withdrawal wins against a previously started restoration", async () => {
    storage.set(consentKey + accountA, "yes");
    const runtime = await boot(),
      delayed = delayNextEnable();
    const restoring = runtime.refreshMobileAccount();
    await vi.waitFor(() => expect(delayed.started()).toBe(true));
    const withdrawing = runtime.setMobileAnalyticsConsent(false);
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    expect(storage.get(consentKey + accountA)).toBe("no");
    delayed.finish();
    await Promise.all([restoring, withdrawing]);
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    const consentCalls = native.request.mock.calls.filter(
      ([method]) => method === "analytics.consent",
    );
    expect(consentCalls.at(-1)?.[1]).toEqual({ enabled: false });
  });
  it("a failed storage write cannot restore an old persisted opt-in in this session", async () => {
    storage.set(consentKey + accountA, "yes");
    const runtime = await boot();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => {
        throw new Error("STORAGE_UNAVAILABLE");
      },
    });
    await expect(runtime.setMobileAnalyticsConsent(false)).rejects.toThrow(
      "ANALYTICS_CHOICE_NOT_PERSISTED",
    );
    native.request.mockClear();
    await runtime.refreshMobileAccount();
    expect(storage.get(consentKey + accountA)).toBe("yes");
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    expect(native.request).not.toHaveBeenCalledWith("analytics.consent", { enabled: true });
  });
  it("does not confirm or retain an opt-in when consent storage cannot be written", async () => {
    const runtime = await boot();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => {
        throw new Error("STORAGE_UNAVAILABLE");
      },
    });
    await expect(runtime.setMobileAnalyticsConsent(true)).rejects.toThrow(
      "ANALYTICS_CHOICE_NOT_PERSISTED",
    );
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    const calls = native.request.mock.calls.filter(([method]) => method === "analytics.consent");
    expect(calls.at(-1)?.[1]).toEqual({ enabled: false });
    native.request.mockClear();
    await runtime.refreshMobileAccount();
    expect(native.request).not.toHaveBeenCalledWith("analytics.consent", { enabled: true });
  });
  it("reports an unpersisted withdrawal even when Firebase is unavailable", async () => {
    native.request.mockImplementation(async (method: string) =>
      method === "runtime.configure"
        ? { ...info, configured: { firebase: false, ads: false } }
        : {},
    );
    const runtime = await boot();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => {
        throw new Error("STORAGE_UNAVAILABLE");
      },
    });
    await expect(runtime.setMobileAnalyticsConsent(false)).rejects.toThrow(
      "ANALYTICS_CHOICE_NOT_PERSISTED",
    );
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
  });
  it("configuration expiry invalidates an in-flight enable and keeps the native queue denied", async () => {
    const runtime = await boot(),
      delayed = delayNextEnable();
    const enabling = runtime.setMobileAnalyticsConsent(true).catch((error: Error) => error.message);
    await vi.waitFor(() => expect(delayed.started()).toBe(true));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60_000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("OFFLINE"));
    await runtime.refreshMobileConfig();
    delayed.finish();
    expect(await enabling).toBe("ANALYTICS_INTERRUPTED");
    await vi.waitFor(() => {
      const calls = native.request.mock.calls.filter(([method]) => method === "analytics.consent");
      expect(calls.at(-1)?.[1]).toEqual({ enabled: false });
    });
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    expect(storage.get(consentKey + accountA)).not.toBe("yes");
  });
});
