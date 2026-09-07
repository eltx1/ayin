import { describe, expect, it } from "vitest";

import { createRequestTraceContext, normalizeTraceId } from "./observability-context.js";
import { classifyError, redactText, redactValue, statusClass } from "./observability-core.js";

describe("observability safety", () => {
  it("redacts credential-like fields and strings", () => {
    const value = redactValue({
      password: "secret-password",
      sessionToken: "session-secret",
      nested: { streamKey: "live-secret", ordinary: "safe" },
    });
    expect(value).toEqual({
      password: "[REDACTED]",
      sessionToken: "[REDACTED]",
      nested: { streamKey: "[REDACTED]", ordinary: "safe" },
    });
    expect(redactText("authorization=abc Bearer xyz.password.token")).not.toContain("abc");
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
