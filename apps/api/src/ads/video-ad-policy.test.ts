import { describe, expect, it } from "vitest";

import { defaultVideoAdSettings } from "./video-ad.service.js";
import { resolveVideoAdPolicy, type VideoAdOverrideValue } from "./video-ad-policy.js";

const emptyOverride: VideoAdOverrideValue = {
  enabled: null,
  preRollEnabled: null,
  midRollEnabled: null,
  postRollEnabled: null,
  provider: null,
  vastTagUrl: null,
  midRollEverySec: null,
};

describe("video ad policy", () => {
  it("uses safe global defaults when no override exists", () => {
    const resolved = resolveVideoAdPolicy(defaultVideoAdSettings, null, null);
    expect(resolved.preRollEnabled).toBe(true);
    expect(resolved.midRollEnabled).toBe(false);
    expect(resolved.provider).toBe("GOOGLE_IMA");
  });

  it("lets a video override take precedence over its channel override", () => {
    const resolved = resolveVideoAdPolicy(
      { ...defaultVideoAdSettings, midRollEnabled: true },
      { ...emptyOverride, enabled: false, preRollEnabled: false },
      { ...emptyOverride, enabled: true, preRollEnabled: true, midRollEverySec: 300 },
    );
    expect(resolved.enabled).toBe(true);
    expect(resolved.preRollEnabled).toBe(true);
    expect(resolved.midRollEverySec).toBe(300);
  });

  it("does not let an unsupported provider override replace Google IMA", () => {
    const resolved = resolveVideoAdPolicy(defaultVideoAdSettings, {
      ...emptyOverride,
      provider: "UNTRUSTED_PROVIDER",
    }, null);
    expect(resolved.provider).toBe("GOOGLE_IMA");
  });
});
