import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { directorySections } from "./public-directory";
import { canonicalPublicPath } from "./public-route-aliases";

const appRoot = new URL("../app/", import.meta.url);
const pagePatterns = readdirSync(appRoot, { recursive: true, encoding: "utf8" })
  .filter((file) => file.replaceAll("\\", "/").endsWith("page.tsx"))
  .map((file) =>
    file
      .replaceAll("\\", "/")
      .split("/")
      .slice(0, -1)
      .filter((segment) => !segment.startsWith("(")),
  )
  // The generic section page is deliberately a closed four-section directory,
  // not proof that every arbitrary top-level navigation link is implemented.
  .filter((parts) => !(parts.length === 1 && parts[0] === "[section]"));

function hasProductDestination(path: string) {
  const canonical = canonicalPublicPath(path).split(/[?#]/)[0]!;
  if (directorySections.some((section) => canonical === `/${section}`)) return true;
  const parts = canonical.split("/").filter(Boolean);
  return pagePatterns.some(
    (pattern) =>
      pattern.length === parts.length &&
      pattern.every((segment, index) => segment.startsWith("[") || segment === parts[index]),
  );
}

// Check declared navigation in its source of truth, rather than repeating a
// hard-coded list that silently stays green after a link changes. Dynamic entity
// links and role visibility still need their existing API/browser acceptance.
describe("declared Viewer, Studio and Admin destinations", () => {
  it.each([
    ["../components/admin/admin-sidebar.tsx", 19],
    ["../app/studio/layout.tsx", 12],
    ["../components/viewer/viewer-shell.tsx", 6],
  ] as const)("%s points at implemented pages", (sourcePath, minimumTargets) => {
    const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
    const targets = [
      ...source.matchAll(/\bhref\s*[:=]\s*["'](\/[^"']*)["']/g),
      ...source.matchAll(/\bhref\(\s*["'](\/[^"']*)["']/g),
      ...source.matchAll(/\[\s*"studio\.[^"]+",\s*"(\/[^"']*)"/g),
    ].map((match) => match[1]!);
    expect(targets.length).toBeGreaterThanOrEqual(minimumTargets);
    expect(pagePatterns.length).toBeGreaterThan(40);
    for (const target of targets) expect(hasProductDestination(target), target).toBe(true);
    expect(hasProductDestination("/not-an-implemented-section")).toBe(false);
  });
});
