import { describe, expect, it, vi } from "vitest";
import {
  reconcileMobileNavigation,
  type MobileNavigationAdPort,
  type MobileNavigationPermission,
} from "./mobile-navigation-ads";

function harness() {
  let finish!: () => void;
  let clock = 0;
  let eligible = true;
  let idle = true;
  let route = "/search";
  let permission: MobileNavigationPermission = {
    accountId: "account-a",
    consentGranted: true,
    configuration: {},
  };
  const listeners = new Set<() => void>();
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const request = vi.fn();
  const port: MobileNavigationAdPort = {
    refreshIdentity: vi.fn(() => {
      eligible = false;
      return waiting;
    }),
    permission: () => permission,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    eligible: () => eligible,
    currentRoute: () => route,
    surfaceIdle: () => idle,
    request,
  };
  const controller = new AbortController();
  return {
    port,
    request,
    controller,
    listeners,
    start: (previous: string | null = "/", next = "/search") =>
      reconcileMobileNavigation(previous, next, controller.signal, port, {
        isBrowseRoute: (path) => ["/", "/search", "/c/ayin"].includes(path),
        now: () => clock,
      }),
    settle: () => {
      eligible = true;
      finish();
    },
    restrict: () => {
      eligible = false;
    },
    time: (value: number) => {
      clock = value;
    },
    navigate: (value: string) => {
      route = value;
    },
    busy: () => {
      idle = false;
    },
    update: (patch: Partial<MobileNavigationPermission>) => {
      permission = { ...permission, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
}

describe("native browsing ad navigation reconciliation", () => {
  it("waits for identity eligibility and offers one ad for a current natural transition", async () => {
    const h = harness();
    const result = h.start();
    expect(h.port.refreshIdentity).toHaveBeenCalledOnce();
    expect(h.request).not.toHaveBeenCalled();
    h.settle();
    expect(await result).toBe(true);
    expect(h.request).toHaveBeenCalledExactlyOnceWith("/", "/search");
    expect(h.listeners.size).toBe(0);
  });

  it.each([null, "/search", "/watch/video", "/clips", "/upload"])(
    "does not create a transition from initial/same/content route %s",
    async (previous) => {
      const h = harness();
      const result = h.start(previous);
      h.settle();
      expect(await result).toBe(false);
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it("does not replay navigation after consent is newly granted", async () => {
    const h = harness();
    h.update({ consentGranted: false });
    const result = h.start();
    h.update({ consentGranted: true });
    h.settle();
    expect(await result).toBe(false);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("invalidates an opportunity permanently when consent is revoked then granted again", async () => {
    const h = harness();
    const result = h.start();
    h.update({ consentGranted: false });
    h.update({ consentGranted: true });
    h.settle();
    expect(await result).toBe(false);
  });

  it.each([{ accountId: "account-b" }, { configuration: {} }])(
    "discards account or configuration changes during reconciliation",
    async (patch) => {
      const h = harness();
      const result = h.start();
      h.update(patch);
      h.settle();
      expect(await result).toBe(false);
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it("does not offer a stale transition after slow identity reconciliation", async () => {
    const h = harness();
    const result = h.start();
    h.time(1501);
    h.settle();
    expect(await result).toBe(false);
  });

  it.each(["abort", "route", "media", "restriction"])(
    "checks %s again after asynchronous identity work",
    async (change) => {
      const h = harness();
      const result = h.start();
      h.settle();
      if (change === "abort") h.controller.abort();
      if (change === "route") h.navigate("/watch/next");
      if (change === "media") h.busy();
      if (change === "restriction") h.restrict();
      expect(await result).toBe(false);
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it("contains optional identity failures and releases its observer", async () => {
    const h = harness();
    h.port.refreshIdentity = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await h.start()).toBe(false);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
  });
});
