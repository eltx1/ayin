import { describe, expect, it } from "vitest";

import { UnconfiguredLiveIngestProvider } from "./live-provider.js";
import { selectLiveIngestProvider } from "./live.module.js";
import { MuxLiveIngestProvider } from "./mux-live-provider.js";

describe("Task 73 live provider production safety", () => {
  it("falls back when Mux control credentials or webhook verification are incomplete", () => {
    const fallback = new UnconfiguredLiveIngestProvider();
    const mux = new MuxLiveIngestProvider({
      MUX_TOKEN_ID: "token-id",
      MUX_TOKEN_SECRET: "token-secret",
    });

    expect(mux.configured).toBe(false);
    expect(selectLiveIngestProvider(mux, fallback)).toBe(fallback);
  });

  it("keeps Mux control available when the new-stream kill switch is off", () => {
    const fallback = new UnconfiguredLiveIngestProvider();
    const mux = new MuxLiveIngestProvider({
      MUX_TOKEN_ID: "token-id",
      MUX_TOKEN_SECRET: "token-secret",
      MUX_WEBHOOK_SIGNING_SECRET: "webhook-secret",
    });

    expect(mux.configured).toBe(true);
    expect(mux.diagnostics().productionEnabled).toBe(false);
    expect(selectLiveIngestProvider(mux, fallback)).toBe(mux);
  });

  it("enables new provisioning only with the explicit production flag", () => {
    const mux = new MuxLiveIngestProvider({
      MUX_TOKEN_ID: "token-id",
      MUX_TOKEN_SECRET: "token-secret",
      MUX_WEBHOOK_SIGNING_SECRET: "webhook-secret",
      MUX_LIVE_PRODUCTION_ENABLED: "1",
    });

    expect(mux.configured).toBe(true);
    expect(mux.diagnostics().productionEnabled).toBe(true);
    expect(mux.diagnostics().missingConfiguration).toEqual([]);
  });
});
