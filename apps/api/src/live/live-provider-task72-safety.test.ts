import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LIVE_PROVIDER_DECISION } from "./live-provider-decision.js";
import { UnconfiguredLiveIngestProvider } from "./live-provider.js";

describe("Task 72 live provider production safety", () => {
  it("keeps the runtime module wired to the unconfigured adapter", () => {
    const moduleSource = readFileSync(new URL("./live.module.ts", import.meta.url), "utf8");
    expect(moduleSource).toContain("UnconfiguredLiveIngestProvider");
    expect(moduleSource).toContain(
      "{ provide: LIVE_INGEST_PROVIDER, useExisting: UnconfiguredLiveIngestProvider }",
    );
    expect(moduleSource).not.toContain("MuxLiveIngestProvider");
  });

  it("does not claim production is connected", () => {
    const provider = new UnconfiguredLiveIngestProvider();
    expect(provider.configured).toBe(false);
    expect(provider.key).toBe("unconfigured");
    expect(LIVE_PROVIDER_DECISION.productionConnected).toBe(false);
    expect(LIVE_PROVIDER_DECISION.productionBehaviorChanged).toBe(false);
  });
});
