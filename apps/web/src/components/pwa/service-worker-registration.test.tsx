import { afterEach, describe, expect, it, vi } from "vitest";
// Exercise the registration effect directly; this is client orchestration evidence, not WebView evidence.
vi.mock("react", () => ({ useEffect: (effect: () => unknown) => effect() }));
import { ServiceWorkerRegistration } from "./service-worker-registration";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("native versus PWA cache ownership", () => {
  it("never registers the PWA service worker in a supported hosted native shell", () => {
    vi.stubEnv("NODE_ENV", "production");
    const host: Record<string, unknown> = {
      AyinMobile: { version: 1, capabilities: [], request() {} },
    };
    host.self = host;
    host.top = host;
    vi.stubGlobal("window", host);
    const register = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    ServiceWorkerRegistration();
    expect(register).not.toHaveBeenCalled();
  });
  it("preserves production PWA registration in an ordinary browser", () => {
    vi.stubEnv("NODE_ENV", "production");
    const host: Record<string, unknown> = {};
    host.self = host;
    host.top = host;
    vi.stubGlobal("window", host);
    const register = vi.fn(async () => ({}));
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    ServiceWorkerRegistration();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });
});
