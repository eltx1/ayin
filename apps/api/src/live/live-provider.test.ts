import { describe, expect, it } from "vitest";

import { LiveProviderUnavailableError, UnconfiguredLiveIngestProvider } from "./live-provider.js";

describe("live ingest provider boundary", () => {
  it("never pretends an ingest provider exists", async () => {
    const provider = new UnconfiguredLiveIngestProvider();
    expect(provider.key).toBe("unconfigured");
    expect(provider.configured).toBe(false);
    expect(provider.capabilities().ingestProtocols).toEqual([]);
    expect(provider.diagnostics().configured).toBe(false);
    await expect(provider.provision()).rejects.toBeInstanceOf(LiveProviderUnavailableError);
    await expect(provider.rotateKey()).rejects.toBeInstanceOf(LiveProviderUnavailableError);
    await expect(provider.retrieveStatus()).rejects.toBeInstanceOf(LiveProviderUnavailableError);
    expect(() => provider.verifyWebhook()).toThrow(LiveProviderUnavailableError);
    await expect(provider.stop()).resolves.toBeUndefined();
  });
});
