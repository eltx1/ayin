import { describe, expect, it } from "vitest";

import { SearchError } from "./search.errors.js";
import { SearchRateLimiter } from "./search-rate-limiter.js";
import { decodeSearchCursor, encodeSearchCursor, normalizeSearchQuery } from "./search.service.js";

describe("Task 13 search safety helpers", () => {
  it("normalizes Unicode, control characters and whitespace before searching", () => {
    expect(normalizeSearchQuery("  Nova\u0000\t Films  ")).toBe("Nova Films");
    expect(normalizeSearchQuery("ＡＹＩＮ")).toBe("AYIN");
  });

  it("accepts only bounded opaque cursors", () => {
    expect(decodeSearchCursor(encodeSearchCursor(24))).toBe(24);
    expect(() => decodeSearchCursor("not-a-search-cursor")).toThrow(SearchError);
    expect(() => decodeSearchCursor(encodeSearchCursor(193))).toThrow(SearchError);
  });

  it("rate limits each IP and scope independently inside the one-minute window", () => {
    const limiter = new SearchRateLimiter();
    limiter.consume("search", "127.0.0.1", 2, 1_000);
    limiter.consume("search", "127.0.0.1", 2, 1_001);
    expect(() => limiter.consume("search", "127.0.0.1", 2, 1_002)).toThrow(SearchError);

    expect(() => limiter.consume("suggestions", "127.0.0.1", 1, 1_002)).not.toThrow();
    expect(() => limiter.consume("search", "127.0.0.1", 2, 61_001)).not.toThrow();
  });
});
