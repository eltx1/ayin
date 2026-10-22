import { afterEach, describe, expect, it, vi } from "vitest";
// Exercise the registration effect directly; this is client orchestration evidence, not WebView evidence.
vi.mock("react", () => ({ useEffect: (effect: () => unknown) => effect() }));
import { ServiceWorkerRegistration } from "./service-worker-registration";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("native versus PWA cache ownership", () => {
  it("retires inherited same-origin PWA registrations without reloading or clearing upload storage", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const reload = vi.fn();
    const host: Record<string, unknown> = {
      AyinMobile: { version: 1, capabilities: [], request() {} },
      location: { origin: "https://ayin.stream", reload },
    };
    host.self = host;
    host.top = host;
    vi.stubGlobal("window", host);
    const unregister = vi.fn(async () => true);
    const otherUnregister = vi.fn(async () => true);
    const getRegistrations = vi.fn(async () => [
      { scope: "https://ayin.stream/", unregister },
      { scope: "https://other.invalid/", unregister: otherUnregister },
    ]);
    const register = vi.fn(),
      controller = {};
    vi.stubGlobal("navigator", { serviceWorker: { register, getRegistrations, controller } });
    const cacheDelete = vi.fn(),
      databaseDelete = vi.fn();
    vi.stubGlobal("caches", { delete: cacheDelete });
    vi.stubGlobal("indexedDB", { deleteDatabase: databaseDelete });
    ServiceWorkerRegistration();
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(otherUnregister).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(navigator.serviceWorker.controller).toBe(controller);
    expect(reload).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(databaseDelete).not.toHaveBeenCalled();
  });
  it("does not block a native document when unregistering a worker fails", async () => {
    const host: Record<string, unknown> = {
      AyinMobile: { version: 1, capabilities: [], request() {} },
      location: { origin: "https://ayin.stream" },
    };
    host.self = host;
    host.top = host;
    vi.stubGlobal("window", host);
    const unregister = vi.fn(async () => {
      throw new Error("Unavailable worker");
    });
    const register = vi.fn();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register,
        getRegistrations: vi.fn(async () => [{ scope: "https://ayin.stream/", unregister }]),
      },
    });
    ServiceWorkerRegistration();
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
    expect(register).not.toHaveBeenCalled();
  });
  it("preserves production PWA registration in an ordinary browser", () => {
    vi.stubEnv("NODE_ENV", "production");
    const host: Record<string, unknown> = {};
    host.self = host;
    host.top = host;
    vi.stubGlobal("window", host);
    const register = vi.fn(async () => ({}));
    const getRegistrations = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { register, getRegistrations } });
    ServiceWorkerRegistration();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(getRegistrations).not.toHaveBeenCalled();
  });
});
