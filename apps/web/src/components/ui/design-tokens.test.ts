import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../styles/design-tokens.css", import.meta.url), "utf8");
const tokens = Object.fromEntries(
  [...source.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
);
function resolve(name: string): string {
  const seen = new Set<string>();
  while (true) {
    if (seen.has(name)) throw new Error(`Circular token ${name}`);
    seen.add(name);
    const value = tokens[name];
    if (!value) throw new Error(`Missing token ${name}`);
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (!alias) return value;
    name = alias[1]!;
  }
}
function luminance(hex: string): number {
  if (!/^#[a-f0-9]{6}$/i.test(hex)) throw new Error(`Expected opaque sRGB token: ${hex}`);
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const component = parseInt(hex.slice(index, index + 2), 16) / 255;
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
function contrast(foreground: string, background: string) {
  const values = [luminance(resolve(foreground)), luminance(resolve(background))].sort(
    (a, b) => b - a,
  );
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("AYIN semantic design tokens", () => {
  it("retains the accepted palette, spacing and safe-area contract", () => {
    expect(resolve("--background")).toBe("#020208");
    expect(resolve("--foreground")).toBe("#fcfaff");
    expect(resolve("--brand-violet")).toBe("#5808f8");
    expect(resolve("--space-5")).toBe("1.5rem");
    expect(resolve("--content-max")).toBe("1600px");
    expect(resolve("--control-target")).toBe("44px");
    expect(resolve("--ayin-safe-bottom")).toBe("env(safe-area-inset-bottom, 0px)");
    const globalCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(globalCss).toContain('@import "../styles/design-tokens.css"');
    expect(globalCss).toContain("prefers-reduced-motion");
    expect(globalCss).not.toContain("--brand-violet:");
  });
  it("keeps small text at 4.5:1 across all migrated opaque states without rounding", () => {
    for (const background of [
      "--background",
      "--surface",
      "--surface-raised",
      "--surface-elevated",
      "--surface-navigation",
      "--surface-selected",
    ]) {
      for (const foreground of [
        "--text-primary",
        "--text-secondary",
        "--text-muted",
        "--text-accent",
      ]) {
        expect(
          contrast(foreground, background),
          `${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const background of [
      "--action-fill",
      "--action-hover",
      "--action-danger-fill",
      "--action-danger-hover",
    ]) {
      expect(contrast("--action-text", background), background).toBeGreaterThanOrEqual(4.5);
    }
    for (const tone of ["info", "success", "warning", "danger"]) {
      expect(contrast(`--${tone}`, `--status-${tone}-bg`), tone).toBeGreaterThanOrEqual(4.5);
      expect(contrast("--text-secondary", `--status-${tone}-bg`), tone).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("retains discernible control boundaries and opt-out of loading motion", () => {
    expect(contrast("--action-outline", "--surface")).toBeGreaterThanOrEqual(3);
    expect(contrast("--action-outline", "--surface-raised")).toBeGreaterThanOrEqual(3);
    expect(contrast("--focus-ring", "--surface-elevated")).toBeGreaterThanOrEqual(3);
    const css = readFileSync(new URL("./design-system.module.css", import.meta.url), "utf8");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("forced-colors: active");
    expect(css).toContain("min-block-size: var(--control-target)");
  });
});
