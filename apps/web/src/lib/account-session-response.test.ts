import { describe, expect, it } from "vitest";
import {
  parseAccountSessions,
  parsePasswordChanged,
  parseSessionRevoked,
  parseSessionsRevoked,
} from "./account-session-response";
const session = {
  id: "00000000-0000-4000-8000-000000000001",
  current: true,
  status: "ACTIVE",
  deviceLabel: "Actual browser",
  createdAt: "2026-10-03T12:00:00Z",
  lastActiveAt: "2026-10-03T12:00:00Z",
  expiresAt: "2026-10-04T12:00:00Z",
  revokedAt: null,
  internalSecret: "excluded",
};
describe("account session response boundaries", () => {
  it("projects only safe actual session fields and accepts actual empty lists", () => {
    const rows = parseAccountSessions({ sessions: [session] });
    expect(rows[0]).not.toHaveProperty("internalSecret");
    expect(rows[0]).not.toHaveProperty("revokedAt");
    expect(parseAccountSessions({ sessions: [] })).toEqual([]);
  });
  it("rejects malformed lists, duplicate identities and multiple current sessions", () => {
    for (const value of [
      null,
      { sessions: {} },
      { sessions: [session, session] },
      { sessions: [session, { ...session, id: "00000000-0000-4000-8000-000000000002" }] },
    ])
      expect(() => parseAccountSessions(value)).toThrow();
  });
  it("rejects false dates, status and current flags before display", () => {
    for (const patch of [
      { createdAt: "bad" },
      { expiresAt: null },
      { current: "true" },
      { status: "REVOKED" },
      { id: "bad" },
    ])
      expect(() => parseAccountSessions({ sessions: [{ ...session, ...patch }] })).toThrow();
  });
  it("requires acknowledged revocation to match the captured current-session decision", () => {
    expect(() =>
      parseSessionRevoked({ revoked: true, currentSessionRevoked: false }, false),
    ).not.toThrow();
    for (const value of [
      { revoked: false, currentSessionRevoked: false },
      { revoked: true, currentSessionRevoked: true },
      { revoked: true },
    ])
      expect(() => parseSessionRevoked(value, false)).toThrow();
  });
  it("accepts actual zero and positive revocation counts without coercion", () => {
    expect(parseSessionsRevoked({ revoked: 0 })).toBe(0);
    expect(parseSessionsRevoked({ revoked: 3 })).toBe(3);
    for (const revoked of [-1, 1.5, "2", Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => parseSessionsRevoked({ revoked })).toThrow();
  });
  it("requires changed true and an actual safe password-change revocation count", () => {
    expect(() => parsePasswordChanged({ changed: true, otherSessionsRevoked: 0 })).not.toThrow();
    for (const value of [
      { changed: false, otherSessionsRevoked: 0 },
      { changed: true },
      { changed: true, otherSessionsRevoked: "0" },
    ])
      expect(() => parsePasswordChanged(value)).toThrow();
  });
});
