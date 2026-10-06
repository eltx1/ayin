import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-level lifecycle coverage complements the pure lease/state-machine tests.
// Browser evidence for native concealment belongs to the direct workspace suite.
const source = readFileSync(new URL("./admin-access.tsx", import.meta.url), "utf8");
describe("bounded Admin provider lifecycle wiring", () => {
  it("lets dirty-edit capture confirmation stop navigation before draft invalidation", () => {
    expect(source).toContain('document.addEventListener("click", navigation);');
    expect(source).toContain('document.removeEventListener("click", navigation);');
    expect(source).not.toContain('addEventListener("click", navigation, true)');
  });
  it("keeps draft destruction active in the shared provider while direct editors are absent", () => {
    for (const event of ["pagehide", "freeze", "visibilitychange"])
      expect(source).toContain(`addEventListener("${event}"`);
    expect(source).toContain("scope.invalidate();");
    expect(source).toContain("useLayoutEffect(");
    expect(source).toContain("isAdminScopePath(window.location.pathname)");
  });
  it("uses explicit route/lifecycle rereads without polling or router monkeypatches", () => {
    expect(source).toContain("[pathname, refresh, scope, stopRead]");
    expect(source).toContain('addEventListener("popstate", history, true)');
    expect(source).toContain('addEventListener("pageshow", resume, true)');
    expect(source).not.toMatch(/setInterval|history\.(?:pushState|replaceState)\s*=/);
  });
});
