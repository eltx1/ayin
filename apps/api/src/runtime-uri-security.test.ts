import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Resolve the actual runtime copies used by Fastify's schema compiler and Ajv,
// not a direct test dependency that could hide an unpatched transitive package.
const require = createRequire(import.meta.url);
const fastifyRequire = createRequire(require.resolve("fastify"));
const compilerRequire = createRequire(fastifyRequire.resolve("@fastify/ajv-compiler"));
const ajvRequire = createRequire(compilerRequire.resolve("ajv"));

type UriRuntime = {
  parse: (uri: string) => { host?: string; error?: string };
  serialize: (components: Record<string, unknown>) => string;
  normalize: (uri: string) => string;
};

const consumers = [
  { name: "Fastify schema compiler", resolve: compilerRequire, major: 4, patch: 5 },
  { name: "Ajv reference resolver", resolve: ajvRequire, major: 3, patch: 8 },
];

// Upstream advisories and selected patch releases are recorded in the master
// checkpoint. These checks perform no network requests or production mutations.
for (const consumer of consumers) {
  const uri = consumer.resolve("fast-uri") as UriRuntime;
  const { version } = consumer.resolve("fast-uri/package.json") as { version: string };

  describe(`${consumer.name} URI safety`, () => {
    it("uses a reviewed patch line, including the host case normalization fix", () => {
      const [major, minor, patch] = version.split(".").map(Number);
      expect(major).toBe(consumer.major);
      expect(minor! > 1 || (minor === 1 && patch! >= consumer.patch)).toBe(true);
    });

    it("rejects a port that could change the serialized authority", () => {
      expect(() =>
        uri.serialize({ scheme: "https", host: "example.test", port: "443@127.0.0.1" }),
      ).toThrow(/port is malformed/i);
    });

    it("rejects unbalanced authority brackets before a host decision", () => {
      const malformed = [
        "https://[fe80",
        "https://user@[@127.0.0.1:8123/admin",
        "https://user@prefix]@127.0.0.1:8123/admin",
      ];
      for (const input of malformed) {
        expect(uri.parse(input).error).toMatch(/host is malformed/i);
      }
    });

    it("normalizes percent-encoded ASCII host case consistently", () => {
      expect(uri.parse("https://%45XAMPLE.test/catalog").host).toBe("example.test");
    });

    it("preserves ordinary HTTPS links and valid IPv6", () => {
      const result = uri.serialize({
        scheme: "https",
        host: "example.test",
        port: "8443",
        path: "/catalog",
      });
      expect(result).toBe("https://example.test:8443/catalog");
      expect(uri.parse(result)).toMatchObject({ host: "example.test" });
      expect(uri.parse(result).error).toBeUndefined();
      expect(uri.parse("https://[::1]/catalog").error).toBeUndefined();
      expect(uri.normalize(result)).toBe(result);
    });
  });
}
