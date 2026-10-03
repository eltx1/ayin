import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { readSessionToken } from "./session-transport.js";
import { isAllowedCookieMutationOrigin, usesCookieSession } from "../security/request-security.js";

const request = (headers: FastifyRequest["headers"]) =>
  ({ headers, method: "PATCH" }) as FastifyRequest;
describe("Explicit session transport identity", () => {
  it("handles a long whitespace-only explicit bearer without falling back or accepting malformed scheme boundaries", () => {
    const cookie = "ayin_session=other-identity";
    expect(
      readSessionToken(request({ authorization: "bearer\t" + "\t\t".repeat(32_000), cookie })),
    ).toBeNull();
    expect(
      readSessionToken(
        request({ authorization: "Bearer" + " \t".repeat(32_000) + "actual-token", cookie }),
      ),
    ).toBe("actual-token");
    for (const authorization of [
      "Beareractual-token",
      " Bearer actual-token",
      "Bearer\nactual-token",
      "Bearer actual\ntoken",
      "Bearer actual\rtoken",
    ]) {
      expect(readSessionToken(request({ authorization, cookie }))).toBeNull();
    }
  });
  it("rejects every explicit invalid Authorization value without using a valid cookie", () => {
    for (const authorization of ["", "Bearer", "Bearer ", "Bearer   ", "Basic abc", "Bearer\t "]) {
      const r = request({
        authorization,
        cookie: "ayin_session=valid-cookie-identity",
        origin: "https://evil.example",
      });
      expect(readSessionToken(r)).toBeNull();
      expect(usesCookieSession(r)).toBe(false);
    }
  });
  it("takes the actual explicit bearer identity with case-insensitive scheme and no cookie fallback", () => {
    for (const authorization of [
      "Bearer actual-token",
      "bearer actual-token",
      "BEARER\tactual-token",
    ]) {
      const r = request({ authorization, cookie: "ayin_session=other-identity" });
      expect(readSessionToken(r)).toBe("actual-token");
      expect(usesCookieSession(r)).toBe(false);
      expect(isAllowedCookieMutationOrigin(r, "https://ayin.stream")).toBe(true);
    }
  });
  it("retains cookie transport and its Origin check only when authorization is absent", () => {
    const r = request({ cookie: "other=1; ayin_session=actual%2Ecookie" });
    expect(readSessionToken(r)).toBe("actual.cookie");
    expect(usesCookieSession(r)).toBe(true);
    expect(isAllowedCookieMutationOrigin(r, "https://ayin.stream")).toBe(false);
    r.headers.origin = "https://ayin.stream";
    expect(isAllowedCookieMutationOrigin(r, "https://ayin.stream")).toBe(true);
  });
  it("rejects malformed percent-encoding and ambiguous empty first session cookies without throwing", () => {
    for (const cookie of [
      "ayin_session=%",
      "ayin_session=%E0%A4%A",
      "ayin_session=; ayin_session=other",
    ]) {
      expect(readSessionToken(request({ cookie }))).toBeNull();
    }
    expect(readSessionToken(request({ cookie: "other=not-a-session" }))).toBeNull();
  });
});
