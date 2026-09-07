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

  it("redacts signed URL credentials", () => {
    const redacted = redactText(
      "https://media.example/object?X-Amz-Credential=credential-value&X-Amz-Signature=signature-value&X-Amz-Security-Token=session-value",
    );
    expect(redacted).not.toContain("credential-value");
    expect(redacted).not.toContain("signature-value");
    expect(redacted).not.toContain("session-value");
  });

  it("does not serialize raw Error messages", () => {
    expect(redactValue(new Error("kyc=raw-sensitive-value"))).toEqual({ name: "Error" });
  });

  it("accepts only standard opaque trace identifiers", () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    expect(normalizeTraceId(requestId)).toBe(requestId);
    expect(normalizeTraceId("4bf92f3577b34da6a3ce929d0e0e4736")).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(normalizeTraceId("bad id with spaces")).toBeNull();
    expect(normalizeTraceId("token=secret-value")).toBeNull();
    expect(normalizeTraceId("opaque-session-token-looking-value")).toBeNull();
    const context = createRequestTraceContext({ "x-request-id": requestId });
    expect(context).toEqual({ requestId, correlationId: requestId });
  });

  it("classifies common operational failures without inspecting request bodies", () => {
    expect(classifyError(null, "/auth/login", 401)).toBe("authentication");
    expect(classifyError(null, "/media/uploads", 500)).toBe("media");
    expect(classifyError(new Error("R2 storage unavailable"))).toBe("storage");
    expect(classifyError(new Error("Google IMA failure"))).toBe("advertising");
    expect(statusClass(503)).toBe("5xx");
  });
});
