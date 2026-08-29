import { describe, expect, it } from "vitest";

import { canEditComment, defaultCommentPolicy, normalizeCommentBody } from "./comment-policy.js";

describe("comment policy", () => {
  it("normalizes plain text and rejects blocked terms", () => {
    expect(normalizeCommentBody("  hello\r\nworld  ", defaultCommentPolicy)).toBe("hello\nworld");
    expect(() =>
      normalizeCommentBody("contains Forbidden phrase", {
        ...defaultCommentPolicy,
        blockedTerms: ["forbidden"],
      }),
    ).toThrow("COMMENT_BLOCKED_TERM");
  });

  it("enforces the configurable edit window", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    expect(canEditComment(createdAt, new Date("2026-01-01T00:29:00Z"), defaultCommentPolicy)).toBe(true);
    expect(canEditComment(createdAt, new Date("2026-01-01T00:31:00Z"), defaultCommentPolicy)).toBe(false);
  });
});
