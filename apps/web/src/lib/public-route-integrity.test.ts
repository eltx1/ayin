import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";
import { navigationItems } from "./navigation";
import { canonicalPublicPath } from "./public-route-aliases";
import { directorySections } from "./public-directory";

const at = (path: string) => new URL(path, import.meta.url);
describe("primary public route integrity", () => {
  it("canonicalizes only deliberate legacy routes, preserving locale and other paths", () => {
    expect(canonicalPublicPath("/shorts")).toBe("/clips");
    expect(canonicalPublicPath("/ar/shorts")).toBe("/ar/clips");
    expect(canonicalPublicPath("/uploads", "ar")).toBe("/ar/upload");
    expect(canonicalPublicPath("/en/uploads", "ar")).toBe("/upload");
    expect(canonicalPublicPath("/c/shorts")).toBe("/c/shorts");
    expect(canonicalPublicPath("/shorts-other")).toBe("/shorts-other");
  });
  it("all default primary destinations have a concrete page or implemented directory", () => {
    for (const item of navigationItems) {
      expect(item.href).toBe(canonicalPublicPath(item.href));
      const section = item.href.slice(1);
      if (directorySections.some((value) => value === section)) continue;
      expect(
        existsSync(at(`../app/(viewer)/${section ? `${section}/` : ""}page.tsx`)),
        item.href,
      ).toBe(true);
    }
    expect(readFileSync(at("../app/(viewer)/[section]/page.tsx"), "utf8")).not.toContain(
      "Ready for the next layer",
    );
  });
  it("has one manifest authority and shortcuts resolve to current product routes", () => {
    expect(existsSync(at("../../public/manifest.webmanifest"))).toBe(false);
    const shortcuts = manifest().shortcuts!;
    expect(shortcuts.map((item) => item.url)).toEqual(["/upload", "/tv"]);
    for (const item of shortcuts) expect(item.url).toBe(canonicalPublicPath(item.url));
  });
});
