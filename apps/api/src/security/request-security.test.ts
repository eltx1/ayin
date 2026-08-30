import { describe, expect, it } from "vitest";

import {
  isAllowedCookieMutationOrigin,
  isUnsafeMethod,
  usesCookieSession,
} from "./request-security.js";

const webOrigin = "https://ayin.stream";

describe("request security", () => {
  it("accepts same-origin cookie mutations", () => {
    const request = {
      method: "POST",
      headers: {
        cookie: "ayin_session=abc",
        origin: webOrigin,
      },
    };

    const allowed = isAllowedCookieMutationOrigin(request as never, webOrigin);
    expect(allowed).toBe(true);
  });

  it("rejects cross-origin and originless cookie mutations", () => {
    const crossOrigin = {
      method: "PATCH",
      headers: {
        cookie: "ayin_session=abc",
        origin: "https://evil.example",
      },
    };
    const originless = {
      method: "PATCH",
      headers: {
        cookie: "ayin_session=abc",
      },
    };

    expect(isAllowedCookieMutationOrigin(crossOrigin as never, webOrigin)).toBe(false);
    expect(isAllowedCookieMutationOrigin(originless as never, webOrigin)).toBe(false);
  });

  it("permits bearer mutations and safe cookie reads", () => {
    const bearerMutation = {
      method: "PATCH",
      headers: {
        cookie: "ayin_session=abc",
        authorization: "Bearer token",
      },
    };
    const safeRead = {
      method: "GET",
      headers: {
        cookie: "ayin_session=abc",
      },
    };

    expect(isAllowedCookieMutationOrigin(bearerMutation as never, webOrigin)).toBe(true);
    expect(isAllowedCookieMutationOrigin(safeRead as never, webOrigin)).toBe(true);
  });

  it("detects unsafe methods and cookie transport", () => {
    const cookieRequest = {
      headers: {
        cookie: "other=1; ayin_session=abc",
      },
    };
    const bearerRequest = {
      headers: {
        cookie: "ayin_session=abc",
        authorization: "Bearer token",
      },
    };

    expect(isUnsafeMethod("DELETE")).toBe(true);
    expect(isUnsafeMethod("HEAD")).toBe(false);
    expect(usesCookieSession(cookieRequest as never)).toBe(true);
    expect(usesCookieSession(bearerRequest as never)).toBe(false);
  });
});
