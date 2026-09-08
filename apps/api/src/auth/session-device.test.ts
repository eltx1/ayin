import { describe, expect, it } from "vitest";

import { describeSessionDevice } from "./session-device.js";

describe("session device description", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0 Safari/537.36",
      "Chrome on Windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1 Version/18 Mobile/15 Safari/604.1",
      "Safari on iPhone",
    ],
    ["Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0) AppleWebKit/537.3", "AYIN TV on Smart TV"],
  ])("reduces %s to a coarse label", (userAgent, expected) => {
    expect(describeSessionDevice(userAgent)).toBe(expected);
  });

  it("does not retain an unknown raw user agent", () => {
    expect(describeSessionDevice("PrivateClient/123 exact-device-id-456")).toBe(
      "Browser on unknown device",
    );
    expect(describeSessionDevice(undefined)).toBe("Unknown device");
  });
});
