import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const homePage = readFileSync(new URL("../app/(viewer)/page.tsx", import.meta.url), "utf8");
const discoveryRow = readFileSync(
  new URL("../components/discovery/discovery-row.tsx", import.meta.url),
  "utf8",
);
const myAyin = readFileSync(
  new URL("../components/discovery/my-ayin-library.tsx", import.meta.url),
  "utf8",
);

describe("Task 12 consumer discovery surfaces", () => {
  it("uses the real discovery browser instead of placeholder catalog cards", () => {
    expect(homePage).toContain("<DiscoveryHome />");
    expect(homePage).not.toContain("Preview 01");
    expect(homePage).not.toContain("Preview 06");
  });

  it("keeps large rows lazy and exposes responsive loading states", () => {
    expect(discoveryRow).toContain("Load more");
    expect(discoveryRow).toContain("MediaCardSkeleton");
    expect(discoveryRow).toContain("nextCursor");
  });

  it("builds My AYIN from authenticated API data rather than fake entries", () => {
    expect(myAyin).toContain("fetchMyAyin");
    expect(myAyin).toContain('scope="my-ayin"');
    expect(myAyin).not.toContain("Preview");
  });
});
