import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { directorySections } from "./public-directory";
import { canonicalPublicPath } from "./public-route-aliases";
import { adminNavigation, studioNavigation } from "./workspace-navigation";

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
  // The generic section page is a closed directory, not a wildcard destination.
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

const workspaceCases = [
  {
    name: "Admin",
    sourcePath: "../components/admin/admin-sidebar.tsx",
    sourceSymbol: "visibleAdminNavigation",
    groups: adminNavigation,
    count: 18,
  },
  {
    name: "Studio",
    sourcePath: "../app/studio/layout.tsx",
    sourceSymbol: "studioNavigation",
    groups: studioNavigation,
    count: 12,
  },
];

describe("declared Viewer, Studio and Admin destinations", () => {
  it.each(workspaceCases)("$name uses implemented grouped destinations", (workspace) => {
    const source = readFileSync(new URL(workspace.sourcePath, import.meta.url), "utf8");
    // The declarations moved, so test the actual model and its mounted consumer.
    // Advertising combines sidebar entries; retain the player URL as a direct destination.
    expect(source).toContain('from "@/lib/workspace-navigation"');
    expect(source).toContain(workspace.sourceSymbol);
    expect(source).toContain("<WorkspaceSidebar");
    const targets = workspace.groups.flatMap((group) => group.items.map((item) => item.href));
    expect(targets).toHaveLength(workspace.count);
    expect(new Set(targets).size).toBe(workspace.count);
    expect(pagePatterns.length).toBeGreaterThan(40);
    for (const target of targets) expect(hasProductDestination(target), target).toBe(true);
    expect(hasProductDestination("/admin/video-ads")).toBe(true);
    expect(hasProductDestination("/not-an-implemented-section")).toBe(false);
  });

  it("Viewer links still point to implemented pages, including the new Browse hub", () => {
    const sourcePath = "../components/viewer/viewer-shell.tsx";
    const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
    const targets = [
      ...source.matchAll(/\bhref\s*[:=]\s*["'](\/[^"']*)["']/g),
      ...source.matchAll(/\bhref\(\s*["'](\/[^"']*)["']/g),
    ].map((match) => match[1]!);
    expect(targets.length).toBeGreaterThanOrEqual(6);
    expect(pagePatterns.length).toBeGreaterThan(40);
    for (const target of targets) expect(hasProductDestination(target), target).toBe(true);
    expect(hasProductDestination("/browse")).toBe(true);
    expect(hasProductDestination("/not-an-implemented-section")).toBe(false);
  });
});
