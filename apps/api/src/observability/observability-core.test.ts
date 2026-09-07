import { describe, expect, it } from "vitest";

import { createRequestTraceContext, normalizeTraceId } from "./observability-context.js";
import { classifyError, redactText, redactValue, statusClass } from "./observability-core.js";

describe("observability safety", () => {
  it("redacts credential and financial fields and strings", () => {
    const value = redactValue({
      password: "secret-password",
      sessionToken: "session-secret",
      nested: {
        streamKey: "live-secret",
        iban: "GB82WEST12345698765432",
        ordinary: "safe",
      },
    });
    expect(value).toEqual({
      password: "[REDACTED]",
      sessionToken: "[REDACTED]",
      nested: { streamKey: "[REDACTED]", iban: "[REDACTED]", ordinary: "safe" },
    });
    const redacted = redactText(
      "authorization=abc Bearer xyz.password.token card=4111111111111111 GB82WEST12345698765432",
    );
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("4111111111111111");
    expect(redacted).not.toContain("GB82WEST12345698765432");
  });

  it("does not serialize raw Error messages", () => {
    expect(redactValue(new Error("kyc=raw-sensitive-value"))).toEqual({ name: "Error" });
  });

  it("accepts only bounded safe request identifiers", () => {
    expect(normalizeTraceId("trace-1234")).toBe("trace-1234");
    expect(normalizeTraceId("bad id with spaces")).toBeNull();
    expect(normalizeTraceId("token=secret-value")).toBeNull();
    const context = createRequestTraceContext({ "x-request-id": "request-1234" });
    expect(context).toEqual({ requestId: "request-1234", correlationId: "request-1234" });
  });

  it("classifies common operational failures without inspecting request bodies", () => {
    expect(classifyError(null, "/auth/login", 401)).toBe("authentication");
    expect(classifyError(null, "/media/uploads", 500)).toBe("media");
    expect(classifyError(new Error("R2 storage unavailable"))).toBe("storage");
    expect(classifyError(new Error("Google IMA failure"))).toBe("advertising");
    expect(statusClass(503)).toBe("5xx");
  });
});
