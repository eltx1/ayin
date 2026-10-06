import { describe, expect, it } from "vitest";
import { AuthHttpError } from "./auth.errors.js";
import { assertExpectedSession } from "./assert-expected-session.js";

const session = "a0000000-0000-4000-8000-000000000001";
function rejection(value: unknown, status: number, code: string) {
  try {
    assertExpectedSession(value, session);
    expect.fail("Expected session scope rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(AuthHttpError);
    expect((error as AuthHttpError).getStatus()).toBe(status);
    expect((error as AuthHttpError).getResponse()).toMatchObject({ error: { code } });
  }
}
describe("expected session only narrows authenticated authority", () => {
  it("preserves legacy callers without the optional header", () => {
    expect(() => assertExpectedSession(undefined, session)).not.toThrow();
  });
  it("accepts the validated durable session with case-insensitive UUID comparison", () => {
    expect(() => assertExpectedSession(session.toUpperCase(), session)).not.toThrow();
  });
  it("rejects same-account replacement sessions before controller work", () => {
    rejection("a0000000-0000-4000-8000-000000000002", 409, "SESSION_CHANGED");
  });
  it("rejects malformed, repeated, empty and padded scope headers", () => {
    for (const value of [
      "",
      "bad",
      null,
      [session],
      session + "," + session,
      " " + session,
      session + " ",
    ])
      rejection(value, 400, "EXPECTED_SESSION_INVALID");
  });
});
