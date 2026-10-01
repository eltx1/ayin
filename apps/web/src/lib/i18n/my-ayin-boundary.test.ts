import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const copy = readFileSync(new URL("./my-ayin-copy.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("./my-ayin.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/(viewer)/my-ayin/page.tsx", import.meta.url), "utf8");
const lensPage = readFileSync(
  new URL("../../app/(viewer)/my-ayin/lens/page.tsx", import.meta.url),
  "utf8",
);

describe("My AYIN server/client localization boundary", () => {
  it("keeps server-rendered pages on the pure translator", () => {
    expect(copy).not.toContain('"use client"');
    expect(copy).toContain("export function translateMyAyin");
    expect(page).toContain('from "@/lib/i18n/my-ayin-copy"');
    expect(lensPage).toContain('from "@/lib/i18n/my-ayin-copy"');
    expect(page).not.toContain('from "@/lib/i18n/my-ayin"');
    expect(lensPage).not.toContain('from "@/lib/i18n/my-ayin"');
  });

  it("keeps the locale hook client-only while reusing pure copy helpers", () => {
    expect(client.trimStart()).toMatch(/^"use client";/);
    expect(client).toContain('from "./my-ayin-copy"');
    expect(client).not.toContain("export function translateMyAyin");
  });
});
