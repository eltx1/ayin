import { describe, expect, it } from "vitest";

import { UnconfiguredLiveIngestProvider } from "./live-provider.js";
import { selectLiveIngestProvider } from "./live.module.js";
import { MuxLiveIngestProvider } from "./mux-live-provider.js";

describe("Task 73 live provider production safety", () => {
  it("falls back to the unconfigured provider unless every production gate is present", () => {
    const fallback = new UnconfiguredLiveIngestProvider();
    const mux = new MuxLiveIngestProvider({
      MUX_TOKEN_ID: "token-id",
      MUX_TOKEN_SECRET: "token-secret",
      MUX_WEBHOOK_SIGNING_SECRET: "webhook-secret",
    });

    expect(mux.configured).toBe(false);
    expect(selectLiveIngestProvider(mux, fallback)).toBe(fallback);
  });

  it("selects Mux only when API credentials, webhook verification, and enable flag exist", () => {
    const fallback = new UnconfiguredLiveIngestProvider();
    const mux = new MuxLiveIngestProvider({
      MUX_TOKEN_ID: "token-id",
      MUX_TOKEN_SECRET: "token-secret",
      MUX_WEBHOOK_SIGNING_SECRET: "webhook-secret",
      MUX_LIVE_PRODUCTION_ENABLED: "1",
    });

    expect(mux.configured).toBe(true);
    expect(selectLiveIngestProvider(mux, fallback)).toBe(mux);
  });
});
