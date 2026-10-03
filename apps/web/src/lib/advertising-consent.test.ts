import { afterEach, describe, expect, it } from "vitest";

import {
  getAdvertisingConsentSnapshot,
  registerAdvertisingConsentProvider,
  resetAdvertisingConsentProviderForTests,
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
