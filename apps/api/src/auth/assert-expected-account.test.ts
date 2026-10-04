import { describe, expect, it } from "vitest";
import { AuthHttpError } from "./auth.errors.js";
import { assertExpectedAccount } from "./assert-expected-account.js";

const account = "a0000000-0000-4000-8000-000000000001";
function rejection(value: unknown, status: number, code: string) {
  try {
    assertExpectedAccount(value, account);
    expect.fail("Expected account scope rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(AuthHttpError);
    expect((error as AuthHttpError).getStatus()).toBe(status);
    expect((error as AuthHttpError).getResponse()).toMatchObject({ error: { code } });
  }
}
describe("expected account only narrows actual authenticated authority", () => {
  it("preserves legacy callers without the optional header", () => {
    expect(() => assertExpectedAccount(undefined, account)).not.toThrow();
  });
  it("accepts actual account identity with case-insensitive UUID comparison", () => {
    expect(() => assertExpectedAccount(account.toUpperCase(), account)).not.toThrow();
  });
  it("rejects a different valid account before controller work", () => {
    rejection("a0000000-0000-4000-8000-000000000002", 409, "ACCOUNT_CHANGED");
  });
  it("rejects malformed, repeated, empty and padded scope headers", () => {
    for (const value of [
      "",
      "bad",
      null,
      [account],
      account + "," + account,
      " " + account,
      account + " ",
    ])
      rejection(value, 400, "EXPECTED_ACCOUNT_INVALID");
  });
});
