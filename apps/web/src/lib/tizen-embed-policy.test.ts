import { describe, expect, it } from "vitest";

import nextConfig, {
  TIZEN_EMBED_COOKIE,
  tizenEmbeddedContentSecurityPolicy,
  tizenEmbeddedSecurityHeaders,
} from "../../next.config";

describe("Tizen embedded framing boundary", () => {
  it("allows only packaged-local ancestor schemes for the Tizen iframe", () => {
    const frameAncestors = tizenEmbeddedContentSecurityPolicy
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("frame-ancestors"));

    expect(frameAncestors).toBe("frame-ancestors 'self' file: tizen-widget:");
    expect(frameAncestors).not.toContain("https:");
    expect(tizenEmbeddedSecurityHeaders.some((header) => header.key === "X-Frame-Options")).toBe(
      false,
    );
  });

  it("keeps ordinary AYIN pages frame-denied and scopes the exception by query/cookie", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toBeDefined();

    const general = rules?.find((rule) => Array.isArray(rule.missing));
    expect(general?.headers).toEqual(
      expect.arrayContaining([{ key: "X-Frame-Options", value: "DENY" }]),
    );
    expect(general?.missing).toEqual(
      expect.arrayContaining([
        { type: "query", key: "ayin_tizen_embed", value: "1" },
        { type: "cookie", key: TIZEN_EMBED_COOKIE, value: "1" },
      ]),
    );

    const embedded = rules?.filter((rule) => Array.isArray(rule.has)) ?? [];
    expect(embedded).toHaveLength(2);
    expect(embedded.flatMap((rule) => rule.has ?? [])).toEqual(
      expect.arrayContaining([
        { type: "query", key: "ayin_tizen_embed", value: "1" },
        { type: "cookie", key: TIZEN_EMBED_COOKIE, value: "1" },
      ]),
    );
  });
});
