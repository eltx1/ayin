import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAdvertisingConsentSnapshot,
  normalizeAdvertisingConsent,
  registerAdvertisingConsentProvider,
  resetAdvertisingConsentProviderForTests,
  createAdvertisingConsentScope,
  subscribeAdvertisingConsent,
  type AdvertisingConsentSnapshot,
} from "./advertising-consent";

afterEach(() => resetAdvertisingConsentProviderForTests());

describe("advertising consent boundary", () => {
  it("fails closed if a provider throws or returns an invalid runtime snapshot", () => {
    registerAdvertisingConsentProvider({
      getSnapshot: () => {
        throw new Error("CMP failed");
      },
    });
    expect(getAdvertisingConsentSnapshot().mode).toBe("LIMITED_ADS");
    for (const snapshot of [
      null,
      {},
      { mode: "UNKNOWN", source: "CMP", providerManaged: true },
      { mode: "PERSONALIZED", source: "CMP", providerManaged: "yes" },
    ]) {
      registerAdvertisingConsentProvider({
        getSnapshot: () => snapshot as unknown as ReturnType<typeof getAdvertisingConsentSnapshot>,
      });
      expect(getAdvertisingConsentSnapshot().mode).toBe("LIMITED_ADS");
    }
  });

  it("defaults to limited ads without pretending a CMP exists", () => {
    expect(getAdvertisingConsentSnapshot()).toEqual({
      mode: "LIMITED_ADS",
      source: "SAFE_DEFAULT",
      providerManaged: false,
    });
  });

  it("accepts a real provider boundary when one is registered", () => {
    const unregister = registerAdvertisingConsentProvider({
      getSnapshot: () => ({ mode: "PERSONALIZED", source: "CMP", providerManaged: true }),
    });
    expect(getAdvertisingConsentSnapshot().mode).toBe("PERSONALIZED");
    unregister();
    expect(getAdvertisingConsentSnapshot().mode).toBe("LIMITED_ADS");
  });

  it("does not allow the safe default source to claim personalized consent", () => {
    registerAdvertisingConsentProvider({
      getSnapshot: () => ({
        mode: "PERSONALIZED",
        source: "SAFE_DEFAULT",
        providerManaged: false,
      }),
    });
    expect(getAdvertisingConsentSnapshot().mode).toBe("LIMITED_ADS");
  });
});

describe("trusted advertising consent notifications", () => {
  function observable(initial: AdvertisingConsentSnapshot) {
    let snapshot = initial;
    const subscribers = new Set<() => void>();
    const callbacks: Array<() => void> = [];
    return {
      provider: {
        getSnapshot: () => ({ ...snapshot }),
        subscribe: (callback: () => void) => {
          callbacks.push(callback);
          subscribers.add(callback);
          return () => {
            subscribers.delete(callback);
          };
        },
      },
      change: (next: AdvertisingConsentSnapshot) => {
        snapshot = next;
        for (const subscriber of [...subscribers]) subscriber();
      },
      changeWithoutNotification: (next: AdvertisingConsentSnapshot) => {
        snapshot = next;
      },
      callbacks,
    };
  }
  const personalized: AdvertisingConsentSnapshot = {
    mode: "PERSONALIZED",
    source: "CMP",
    providerManaged: true,
  };

  it("publishes stable frozen normalized snapshots without churn for duplicate notifications", () => {
    const source = observable(personalized);
    const unregister = registerAdvertisingConsentProvider(source.provider);
    const first = getAdvertisingConsentSnapshot();
    expect(getAdvertisingConsentSnapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    const listener = vi.fn();
    const unsubscribe = subscribeAdvertisingConsent(listener);
    source.change({ ...personalized });
    expect(listener).not.toHaveBeenCalled();
    source.change({ ...personalized, ageTreatment: "CHILD" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getAdvertisingConsentSnapshot()).toMatchObject({
      mode: "NON_PERSONALIZED",
      ageTreatment: "CHILD",
    });
    unsubscribe();
    unregister();
  });

  it("revokes old SDK scopes before notifying React, and never revives them after consent returns", () => {
    const source = observable(personalized);
    const unregister = registerAdvertisingConsentProvider(source.provider);
    const scope = createAdvertisingConsentScope();
    const order: string[] = [];
    const unsubscribe = subscribeAdvertisingConsent(() =>
      order.push(`render:${scope.signal.aborted}`),
    );
    scope.signal.addEventListener("abort", () => order.push("destroy"));
    source.change({ ...personalized, mode: "LIMITED_ADS" });
    expect(order).toEqual(["destroy", "render:true"]);
    source.change(personalized);
    expect(scope.isCurrent()).toBe(false);
    const next = createAdvertisingConsentScope();
    expect(next.isCurrent()).toBe(true);
    next.release();
    scope.release();
    unsubscribe();
    unregister();
  });

  it("revokes same-mode authority when a trusted opaque revision changes without churning duplicates", () => {
    const source = observable({ ...personalized, providerRevision: "policy:1" });
    const unregister = registerAdvertisingConsentProvider(source.provider);
    const first = getAdvertisingConsentSnapshot();
    const scope = createAdvertisingConsentScope();
    const order: string[] = [];
    scope.signal.addEventListener("abort", () => order.push("destroy"));
    const unsubscribe = subscribeAdvertisingConsent(() =>
      order.push(`render:${scope.signal.aborted}`),
    );
    source.change({ ...personalized, providerRevision: "policy:1" });
    expect(getAdvertisingConsentSnapshot()).toBe(first);
    expect(order).toEqual([]);
    source.change({ ...personalized, providerRevision: "policy:2" });
    expect(order).toEqual(["destroy", "render:true"]);
    expect(getAdvertisingConsentSnapshot()).toEqual({
      ...personalized,
      providerRevision: "policy:2",
    });
    const next = createAdvertisingConsentScope();
    source.change({ ...personalized, providerRevision: "policy:2" });
    expect(next.isCurrent()).toBe(true);
    // Removing a token also invalidates old authority; snapshot-only providers
    // remain compatible and subsequent duplicate snapshots stay stable.
    source.change(personalized);
    expect(next.signal.aborted).toBe(true);
    const withoutRevision = getAdvertisingConsentSnapshot();
    source.change(personalized);
    expect(getAdvertisingConsentSnapshot()).toBe(withoutRevision);
    expect(scope.isCurrent()).toBe(false);
    next.release();
    scope.release();
    unsubscribe();
    unregister();
  });

  it.each(["", "x".repeat(129), "consent string", 1, null])(
    "fails closed for malformed provider revision %j without weakening a known child restriction",
    (providerRevision) => {
      const source = observable({ ...personalized, ageTreatment: "CHILD", providerRevision: "v1" });
      const unregister = registerAdvertisingConsentProvider(source.provider);
      const scope = createAdvertisingConsentScope();
      source.change({ ...personalized, providerRevision } as unknown as AdvertisingConsentSnapshot);
      expect(scope.signal.aborted).toBe(true);
      expect(getAdvertisingConsentSnapshot()).toEqual({
        mode: "LIMITED_ADS",
        source: "SAFE_DEFAULT",
        providerManaged: false,
        ageTreatment: "CHILD",
      });
      scope.release();
      unregister();
    },
  );

  it("ignores callbacks from a superseded binding even if that provider is restored later", () => {
    const first = observable(personalized);
    const unregisterFirst = registerAdvertisingConsentProvider(first.provider);
    const oldCallback = first.callbacks[0]!;
    const second = observable({ ...personalized, mode: "LIMITED_ADS" });
    const unregisterSecond = registerAdvertisingConsentProvider(second.provider);
    const listener = vi.fn();
    const unsubscribe = subscribeAdvertisingConsent(listener);
    first.change({ ...personalized, ageTreatment: "CHILD" });
    oldCallback();
    expect(getAdvertisingConsentSnapshot().mode).toBe("LIMITED_ADS");
    expect(listener).not.toHaveBeenCalled();
    unregisterSecond();
    expect(getAdvertisingConsentSnapshot().ageTreatment).toBe("CHILD");
    listener.mockClear();
    first.changeWithoutNotification(personalized);
    oldCallback();
    expect(listener).not.toHaveBeenCalled();
    first.callbacks.at(-1)!();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    unregisterFirst();
  });

  it("cannot restore a provider disposed out of registration order", () => {
    const first = observable(personalized),
      second = observable({ ...personalized, mode: "NON_PERSONALIZED" });
    const unregisterFirst = registerAdvertisingConsentProvider(first.provider);
    const unregisterSecond = registerAdvertisingConsentProvider(second.provider);
    unregisterFirst();
    unregisterSecond();
    first.callbacks[0]!();
    second.callbacks[0]!();
    expect(getAdvertisingConsentSnapshot()).toMatchObject({
      mode: "LIMITED_ADS",
      source: "SAFE_DEFAULT",
    });
  });

  it("fails closed on malformed updates and a broken subscription without publishing provisional permission", () => {
    const source = observable(personalized);
    const unregister = registerAdvertisingConsentProvider(source.provider);
    const scope = createAdvertisingConsentScope();
    source.change({
      ...personalized,
      mode: "INVALID",
      ageTreatment: "TEEN",
    } as unknown as AdvertisingConsentSnapshot);
    expect(scope.signal.aborted).toBe(true);
    expect(getAdvertisingConsentSnapshot()).toMatchObject({
      mode: "LIMITED_ADS",
      ageTreatment: "TEEN",
    });
    unregister();
    const notifications: string[] = [];
    const unsubscribe = subscribeAdvertisingConsent(() =>
      notifications.push(getAdvertisingConsentSnapshot().mode),
    );
    const unregisterBroken = registerAdvertisingConsentProvider({
      getSnapshot: () => personalized,
      subscribe: (listener) => {
        listener();
        throw new Error("CMP subscription failed");
      },
    });
    expect(getAdvertisingConsentSnapshot().mode).toBe("LIMITED_ADS");
    expect(notifications).not.toContain("PERSONALIZED");
    unsubscribe();
    unregisterBroken();
    scope.release();
  });

  it("does not erase or weaken a known child classification on malformed or missing updates", () => {
    const source = observable({ ...personalized, ageTreatment: "CHILD" });
    const unregister = registerAdvertisingConsentProvider(source.provider);
    source.change({
      ...personalized,
      mode: "INVALID",
      ageTreatment: "TEEN",
    } as unknown as AdvertisingConsentSnapshot);
    expect(getAdvertisingConsentSnapshot()).toMatchObject({
      mode: "LIMITED_ADS",
      ageTreatment: "CHILD",
    });
    unregister();
    expect(getAdvertisingConsentSnapshot()).toMatchObject({
      mode: "LIMITED_ADS",
      ageTreatment: "CHILD",
    });
  });
});

it("retains explicit age restrictions even when other consent fields fail, without inferring age", () => {
  for (const ageTreatment of ["CHILD", "TEEN"] as const) {
    expect(
      normalizeAdvertisingConsent({
        mode: "PERSONALIZED",
        source: "CMP",
        providerManaged: true,
        ageTreatment,
      }),
    ).toMatchObject({ mode: "NON_PERSONALIZED", ageTreatment });
    expect(normalizeAdvertisingConsent({ mode: "UNKNOWN", ageTreatment })).toMatchObject({
      mode: "LIMITED_ADS",
      ageTreatment,
      providerManaged: false,
    });
    expect(
      normalizeAdvertisingConsent({
        mode: "LIMITED_ADS",
        source: "APPLICATION",
        providerManaged: false,
        ageTreatment,
      }),
    ).toMatchObject({ mode: "LIMITED_ADS", ageTreatment });
  }
  const malformed = normalizeAdvertisingConsent({
    mode: "PERSONALIZED",
    source: "CMP",
    providerManaged: true,
    ageTreatment: "ADULT",
  });
  expect(malformed.mode).toBe("LIMITED_ADS");
  expect(malformed.ageTreatment).toBeUndefined();
});
