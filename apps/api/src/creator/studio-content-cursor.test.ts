import { describe, expect, it } from "vitest";
import { decodeStudioContentCursor, encodeStudioContentCursor } from "./studio-content-cursor.js";

const scope = {
  accountId: "11111111-1111-4111-8111-111111111111",
  channelId: "22222222-2222-4222-8222-222222222222",
  take: 25,
  query: "film night",
  status: "PUBLISHED",
  visibility: "PUBLIC",
};
const boundary = {
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  id: "33333333-3333-4333-8333-333333333333",
};
describe("Studio content issued keyset", () => {
  it("retains the issued timestamp and ID without an anchor lookup", () => {
    const cursor = encodeStudioContentCursor(boundary, scope);
    expect(decodeStudioContentCursor(cursor, scope)).toEqual(boundary);
    expect(
      decodeStudioContentCursor(cursor, { ...scope, cursor: "ignored" } as typeof scope),
    ).toEqual(boundary);
  });
  it.each(["accountId", "channelId", "query", "status", "visibility", "take"] as const)(
    "binds the %s scope",
    (key) => {
      const cursor = encodeStudioContentCursor(boundary, scope);
      const changed = {
        ...scope,
        [key]:
          key === "take"
            ? 50
            : key.endsWith("Id")
              ? boundary.id
              : key === "status"
                ? "DRAFT"
                : key === "visibility"
                  ? "PRIVATE"
                  : "other",
      };
      expect(() => decodeStudioContentCursor(cursor, changed)).toThrow();
    },
  );
  it.each([
    "",
    "abc",
    "a+b",
    "x".repeat(2049),
    Buffer.from("null").toString("base64url"),
    Buffer.from(JSON.stringify({ ...scope, version: 2, ...boundary })).toString("base64url"),
  ])("rejects malformed cursors", (cursor) => {
    expect(() => decodeStudioContentCursor(cursor, scope)).toThrow();
  });
  it("rejects noncanonical timestamp and unknown fields", () => {
    for (const delta of [{ updatedAt: "2026-10-01T00:00:00Z" }, { extra: true }]) {
      const cursor = Buffer.from(
        JSON.stringify({ ...scope, ...boundary, version: 1, ...delta }),
      ).toString("base64url");
      expect(() => decodeStudioContentCursor(cursor, scope)).toThrow();
    }
  });
});
