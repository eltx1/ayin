import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
interface DiagnosticState {
  info: {
    platform: string;
    appVersion: string;
    installationId: string;
    configured: { ads: boolean; firebase: boolean };
    runtimeAllowed: boolean;
  };
  config: {
    analytics: { enabled: boolean };
    ads: { enabled: boolean; platforms: Record<string, { enabled: boolean }> };
  };
  configRevision: string;
  configAppliedAt: string;
  lastConfigCheckAt: string;
  canRequestAds: boolean;
  error: boolean;
}
const port = vi.hoisted(() => ({
  state: {} as DiagnosticState,
  account: "account-a" as string | null,
  profile: "profile-a" as string | null,
  restricted: false,
  refreshing: false,
  listeners: new Set<() => void>(),
}));
vi.mock("./mobile-runtime", () => ({
  getMobileState: () => port.state,
  getMobileAccountId: () => port.account,
  getMobileProfileId: () => port.profile,
  mobileIdentityRefreshing: () => port.refreshing,
  mobileRestricted: () => port.restricted,
  subscribeMobile: (listener: () => void) => {
    port.listeners.add(listener);
    return () => port.listeners.delete(listener);
  },
}));
vi.mock("./mobile-bridge", () => ({ isMobileHost: () => true }));
beforeEach(() => {
  vi.resetModules();
  port.account = "account-a";
  port.profile = "profile-a";
  port.restricted = false;
  port.refreshing = false;
  port.listeners.clear();
  port.state = {
    info: {
      platform: "android",
      appVersion: "1.1.0",
      installationId: "installation",
      configured: { ads: true, firebase: false },
      runtimeAllowed: true,
    },
    config: {
      analytics: { enabled: true },
      ads: { enabled: true, platforms: { android: { enabled: true }, ios: { enabled: true } } },
    },
    configRevision: "a".repeat(64),
    configAppliedAt: "2026-11-14T20:00:00.000Z",
    lastConfigCheckAt: "2026-11-14T20:00:00.000Z",
    canRequestAds: true,
    error: false,
  };
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      AyinMobile: { capabilities: ["share", "upload.sources", "arbitrary.native"] },
    }),
  );
  vi.stubGlobal("document", { visibilityState: "visible" });
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return Response.json({ enabled: true, consentVersion: 1 });
      if (init?.method === "POST" || init?.method === "DELETE") return Response.json({ ok: true });
      return Response.json({ enabled: false, consentVersion: 0 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("first-party operational diagnostics consent and minimization", () => {
  it("never reports or grants consent automatically", async () => {
    const api = await import("./mobile-diagnostics"),
      abort = new AbortController();
    api.installMobileDiagnosticsLifecycle(abort.signal);
    port.listeners.forEach((listener) => listener());
    expect(await api.sendMobileDiagnostics()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    abort.abort();
  });
  it("notifies settings subscribers when an explicit grant or withdrawal changes sharing", async () => {
    const api = await import("./mobile-diagnostics"),
      changed = vi.fn();
    const stop = api.subscribeMobileDiagnostics(changed);
    await api.enableMobileDiagnostics();
    expect(changed).toHaveBeenCalledOnce();
    await api.disableMobileDiagnostics();
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
  });
  it("never restores an old server grant after restart, including failed offline withdrawal", async () => {
    const api = await import("./mobile-diagnostics");
    await api.enableMobileDiagnostics();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await expect(api.disableMobileDiagnostics()).rejects.toThrow();
    vi.resetModules();
    port.listeners.clear();
    const next = await import("./mobile-diagnostics"),
      abort = new AbortController();
    next.installMobileDiagnosticsLifecycle(abort.signal);
    vi.mocked(fetch).mockClear();
    port.listeners.forEach((listener) => listener());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === "DELETE")).toBe(true);
    expect(await next.sendMobileDiagnostics()).toBe(false);
    expect(next.mobileDiagnosticsEnabled()).toBe(false);
    abort.abort();
  });
  it("does not auto-restore a grant even when withdrawal storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "allow",
      setItem() {
        throw new Error("blocked");
      },
    });
    const api = await import("./mobile-diagnostics"),
      abort = new AbortController();
    api.installMobileDiagnosticsLifecycle(abort.signal);
    port.listeners.forEach((listener) => listener());
    expect(await api.sendMobileDiagnostics()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    abort.abort();
  });
  it("requires a verified non-Kids profile independently from Firebase availability", async () => {
    const api = await import("./mobile-diagnostics");
    port.profile = null;
    await expect(api.enableMobileDiagnostics()).rejects.toThrow("DIAGNOSTICS_UNAVAILABLE");
    expect(fetch).not.toHaveBeenCalled();
    port.profile = "profile-a";
    port.restricted = true;
    await expect(api.enableMobileDiagnostics()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses explicit versioned consent, minimizes data and rate-limits duplicate sends", async () => {
    const api = await import("./mobile-diagnostics");
    api.recordMobileAdDiagnostic({
      type: "ad.failed",
      code: 3,
      message: "email@example.com",
      token: "secret",
      unitId: "/123/private",
    });
    await api.enableMobileDiagnostics();
    expect(api.mobileDiagnosticsEnabled()).toBe(true);
    const [, init] = vi.mocked(fetch).mock.calls.find(([, value]) => value?.method === "POST")!;
    expect(init?.headers).toHaveProperty("x-ayin-diagnostics-consent-version", "1");
    const payload = JSON.parse(String(init?.body));
    expect(payload.ads).toEqual({ status: "NO_FILL", lastEvent: "ad_failed", errorCode: 3 });
    expect(payload.firebaseConfigured).toBe(false);
    expect(payload.capabilities).toEqual(["share", "upload.sources"]);
    expect(String(init?.body)).not.toMatch(/email|secret|private|account-a|profile-a/);
    expect(await api.sendMobileDiagnostics()).toBe(false);
    expect(
      vi.mocked(fetch).mock.calls.filter(([, value]) => value?.method === "POST"),
    ).toHaveLength(1);
  });
  it("withdraws immediately even if deletion cannot be confirmed", async () => {
    const api = await import("./mobile-diagnostics");
    await api.enableMobileDiagnostics();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(api.disableMobileDiagnostics()).rejects.toThrow(
      "DIAGNOSTICS_WITHDRAWAL_UNCONFIRMED",
    );
    expect(api.mobileDiagnosticsEnabled()).toBe(false);
    expect(await api.sendMobileDiagnostics()).toBe(false);
  });
  it("cannot restore a delayed read after withdrawal", async () => {
    const api = await import("./mobile-diagnostics");
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const enabling = api.enableMobileDiagnostics();
    await api.disableMobileDiagnostics();
    finish(Response.json({ enabled: true, consentVersion: 1 }));
    await expect(enabling).rejects.toThrow("DIAGNOSTICS_INTERRUPTED");
    expect(api.mobileDiagnosticsEnabled()).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([, value]) => value?.method === "PUT")).toBe(false);
  });
  it("maps timeout and iOS no-fill codes without sending unbounded messages", async () => {
    const api = await import("./mobile-diagnostics");
    api.recordMobileAdDiagnostic({ type: "ad.failed", code: -1 });
    expect(api.getMobileDiagnosticSnapshot().ads).toEqual({
      status: "TIMEOUT",
      lastEvent: "ad_failed",
      errorCode: null,
    });
    port.state.info.platform = "ios";
    api.recordMobileAdDiagnostic({ type: "ad.failed", code: "1" });
    expect(api.getMobileDiagnosticSnapshot().ads.status).toBe("NO_FILL");
    api.recordMobileAdDiagnostic({ type: "ad.failed", code: "email@example.com" });
    expect(api.getMobileDiagnosticSnapshot().ads.errorCode).toBeNull();
  });
});
