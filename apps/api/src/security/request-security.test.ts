import { describe, expect, it } from "vitest";

import { isAllowedCookieMutationOrigin, isUnsafeMethod, usesCookieSession } from "./request-security.js";

describe("request security", () => {
  it("requires the configured origin for cookie-authenticated mutations", () => {
    const request = {
      method: "POST",
      headers: { cookie: "ayin_session=abc", origin: "https://ayin.stream" },
    };
    expect(isAllowedCookieMutationOrigin(request as never, "https://ayin.stream")).toBe(true);
    expect(
      isAllowedCookieMutationOrigin(
        { ...request, headers: { ...request.headers, origin: "https://evil.example" } } as never,
        "https://ayin.stream",
      ),
    ).toBe(false);
  });

  it("rejects originless cookie mutations but permits bearer and safe requests", () => {
    expect(
      isAllowedCookieMutationOrigin(
        { method: "PATCH", headers: { cookie: "ayin_session=abc" } } as never,
        "https://ayin.stream",
      ),
    ).toBe(false);
    expect(
      isAllowedCookieMutationOrigin(
        {
          method: "PATCH",
          headers: { cookie: "ayin_session=abc", authorization: "Bearer token" },
        } as never,
        "https://ayin.stream",
      ),
    ).toBe(true);
    expect(
      isAllowedCookieMutationOrigin(
        { method: "GET", headers: { cookie: "ayin_session=abc" } } as never,
        "https://ayin.stream",
      ),
    ).toBe(true);
  });

  it("detects unsafe methods and cookie transport precisely", () => {
    expect(isUnsafeMethod("DELETE")).toBe(true);
    expect(isUnsafeMethod("HEAD")).toBe(false);
    expect(usesCookieSession({ headers: { cookie: "other=1; ayin_session=abc" } } as never)).toBe(
      true,
    );
    expect(
      usesCookieSession({
        headers: { cookie: "ayin_session=abc", authorization: "Bearer token" },
      } as never),
    ).toBe(false);
  });
});
