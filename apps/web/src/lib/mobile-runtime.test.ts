import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const native = vi.hoisted(() => ({
  request: vi.fn(),
  supports: vi.fn<(capability: string) => boolean>(() => true),
  host: vi.fn(() => true),
}));
vi.mock("./mobile-bridge", async (original) => ({
  ...(await original<typeof import("./mobile-bridge")>()),
  requestMobile: native.request,
  supportsMobile: native.supports,
  isMobileHost: native.host,
}));
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  installation = "33333333-3333-4333-8333-333333333333";
let identity: unknown,
  config: Record<string, unknown>,
  nativeInfo: Record<string, unknown>,
  storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  native.request.mockReset();
  native.host.mockReturnValue(true);
  native.supports.mockReturnValue(true);
  config = JSON.parse(readFileSync("../../docs/MOBILE_RUNTIME_CONTRACT.json", "utf8"));
  config = {
    ...config,
    analytics: { enabled: true },
    ads: { ...(config.ads as object), audience: "general" },
  };
  identity = { account: { id: a }, profile: { isKids: false } };
  nativeInfo = {
    platform: "ios",
    appVersion: "1.1.0",
    installationId: installation,
    boundAccountId: a,
    configured: { firebase: true, ads: false },
  };
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("window", { location: { pathname: "/", search: "" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/mobile/config")) return Response.json(config);
      if (url.endsWith("/auth/me"))
        return identity ? Response.json(identity) : new Response(null, { status: 401 });
      return new Response(null, { status: 404 });
    }),
  );
  native.request.mockImplementation(async (method: string) =>
    method === "runtime.configure" ? nativeInfo : {},
  );
});
afterEach(() => vi.unstubAllGlobals());
function optIn(id: string) {
  storage.set("ayin.mobile.adult.v1:" + id, "yes");
  storage.set("ayin.mobile.analytics.consent.v1:" + id, "yes");
}
const boot = async () => {
  const runtime = await import("./mobile-runtime");
  await runtime.initializeMobile(new AbortController().signal);
  return runtime;
};
describe("mobile identity, consent and notification orchestration (bridge mocks, not device evidence)", () => {
  it("projects GAM from the other platform before configuring an older shell", async () => {
    optIn(a);
    const ads = config.ads as {
      enabled: boolean;
      platforms: { android: { bannerUnitId: string } };
    };
    ads.enabled = true;
    ads.platforms.android.bannerUnitId = "/1/banner";
    native.supports.mockImplementation((capability) => capability !== "ads.gam");
    const runtime = await boot();
    expect(runtime.getMobileState().config?.ads.enabled).toBe(false);
    expect(runtime.getMobileState().analyticsConsent).toBe(true);
    expect(
      native.request.mock.calls.find(([method]) => method === "runtime.configure")?.[1].config.ads
        .platforms.android.bannerUnitId,
    ).toBe("");
    expect(native.request.mock.calls.some(([method]) => method === "privacy.request")).toBe(false);
    expect(runtime.nativeBannerEnabled()).toBe(false);
  });
  it("offers interstitials only for distinct browse transitions with all gates satisfied", async () => {
    optIn(a);
    const ads = config.ads as {
      enabled: boolean;
      interstitial: { enabled: boolean };
      platforms: { ios: { enabled: boolean } };
    };
    ads.enabled = true;
    ads.interstitial.enabled = true;
    ads.platforms.ios.enabled = true;
    nativeInfo.configured = { firebase: true, ads: true };
    const runtime = await boot();
    runtime.updateMobilePrivacy(true);
    native.request.mockClear();
    for (const [previous, next] of [
      [null, "/"],
      ["/", "/"],
      ["/watch/a", "/"],
      ["/", "/clips"],
      ["/upload", "/search"],
    ])
      runtime.requestBrowseInterstitial(previous ?? null, next!);
    expect(native.request).not.toHaveBeenCalled();
    runtime.requestBrowseInterstitial("/", "/search");
    expect(native.request).toHaveBeenCalledExactlyOnceWith("ads.interstitial", {
      placement: "browse_transition",
      naturalTransition: true,
    });
    native.request.mockClear();
    runtime.updateMobilePrivacy(false);
    runtime.requestBrowseInterstitial("/search", "/");
    expect(native.request).not.toHaveBeenCalled();
    runtime.updateMobilePrivacy(true);
    identity = { account: { id: a }, profile: { isKids: true } };
    await runtime.refreshMobileAccount();
    native.request.mockClear();
    runtime.requestBrowseInterstitial("/search", "/");
    expect(native.request).not.toHaveBeenCalled();
  });
  it("keeps Firebase collection off until identity, adult choice and profile are verified", async () => {
    optIn(a);
    const runtime = await boot();
    const calls = native.request.mock.calls;
    const consentCalls = calls.filter(([method]) => method === "analytics.consent");
    expect(consentCalls[0]?.[1]).toEqual({ enabled: false });
    expect(consentCalls[1]?.[1]).toEqual({ enabled: false });
    expect(consentCalls.at(-1)?.[1]).toEqual({ enabled: true });
    expect(runtime.getMobileState().analyticsConsent).toBe(true);
  });
  it("does not restore stored opt-in for a child, missing profile or unconfirmed adult", async () => {
    optIn(a);
    identity = { account: { id: a }, profile: { isKids: true } };
    const runtime = await boot();
    expect(
      native.request.mock.calls.some(
        ([method, value]) => method === "analytics.consent" && value.enabled === true,
      ),
    ).toBe(false);
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    identity = { account: { id: a } };
    await runtime.refreshMobileAccount();
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    identity = { account: { id: a }, profile: { isKids: false } };
    storage.delete("ayin.mobile.adult.v1:" + a);
    await runtime.refreshMobileAccount();
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
  });
  it("preserves native push binding on verified same-owner reload", async () => {
    const runtime = await boot();
    expect(runtime.getMobileAccountId()).toBe(a);
    expect(native.request.mock.calls.some(([method]) => method === "session.reset")).toBe(false);
  });
  it("resets a different persisted owner before assigning any analytics identity", async () => {
    nativeInfo.boundAccountId = b;
    optIn(a);
    await boot();
    const reset = native.request.mock.calls.findIndex(([method]) => method === "session.reset");
    const user = native.request.mock.calls.findIndex(([method]) => method === "analytics.user");
    expect(reset).toBeGreaterThan(-1);
    expect(user).toBeGreaterThan(reset);
  });
  it("turns off analytics on same-account child profile switch and does not inherit another account's consent", async () => {
    optIn(a);
    const runtime = await boot();
    identity = { account: { id: a }, profile: { isKids: true } };
    await runtime.refreshMobileAccount();
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    identity = { account: { id: b }, profile: { isKids: false } };
    await runtime.refreshMobileAccount();
    expect(runtime.getMobileAccountId()).toBe(b);
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
    expect(native.request.mock.calls.some(([method]) => method === "session.reset")).toBe(true);
  });
  it("ignores late previous-account token and notification events", async () => {
    const runtime = await boot();
    identity = { account: { id: b }, profile: { isKids: false } };
    await runtime.refreshMobileAccount();
    expect(await runtime.registerMobileTokenEvent(a, "FCM_TOKEN_12345678901234567890")).toBe(false);
    expect(runtime.currentMobileRecipient(a)).toBe(false);
    expect(runtime.currentMobileRecipient(b)).toBe(true);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) => String(url).endsWith("/mobile/devices") && init?.method === "POST",
        ),
    ).toBe(false);
  });
  it("Firebase unavailable never invalidates verified AYIN authentication", async () => {
    nativeInfo.configured = { firebase: false, ads: true };
    native.request.mockImplementation(async (method: string) => {
      if (method.startsWith("analytics.")) throw new Error("FIREBASE_UNAVAILABLE");
      return method === "runtime.configure" ? nativeInfo : {};
    });
    const runtime = await boot();
    expect(runtime.getMobileAccountId()).toBe(a);
    expect(runtime.getMobileState().ready).toBe(true);
    expect(runtime.getMobileState().analyticsConsent).toBe(false);
  });
  it("failed config produces a nonblocking disabled native runtime", async () => {
    config.schemaVersion = 99;
    const runtime = await boot();
    expect(runtime.getMobileState()).toMatchObject({
      ready: true,
      error: true,
      canRequestAds: false,
      analyticsConsent: false,
    });
    expect(native.request).not.toHaveBeenCalled();
  });
  it("ordinary browser does not fetch native config or invoke native SDKs", async () => {
    native.host.mockReturnValue(false);
    await boot();
    expect(fetch).not.toHaveBeenCalled();
    expect(native.request).not.toHaveBeenCalled();
  });
  it("clears a persisted push owner when its authenticated session has expired", async () => {
    identity = null;
    const runtime = await boot();
    expect(runtime.getMobileAccountId()).toBeNull();
    expect(native.request.mock.calls.some(([method]) => method === "session.reset")).toBe(true);
  });
  it("does not undo a local notification opt-out after a failed server detach", async () => {
    config.notifications = { enabled: true, types: ["system"], richMedia: false };
    const runtime = await boot();
    await expect(runtime.disableMobileNotifications()).rejects.toThrow("DEVICE_DETACH_FAILED");
    expect(runtime.getMobileState().notificationsEnabled).toBe(false);
    vi.mocked(fetch).mockClear();
    native.request.mockClear();
    await runtime.refreshMobileAccount();
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/mobile/devices/")),
    ).toBe(false);
    expect(native.request.mock.calls.some(([method]) => method === "notifications.token")).toBe(
      false,
    );
  });
});
