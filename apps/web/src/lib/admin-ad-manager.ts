export type AdSlotSource = "CODE" | "GAM_UNIT" | "HOUSE" | "NONE";
export type AdSlotDevice = "MOBILE" | "DESKTOP" | "TV";

export interface AdManagerSlot {
  key: string;
  name: { en: string; ar: string };
  where: { en: string; ar: string };
  sizes: Array<[number, number]>;
  enabled: boolean;
  source: AdSlotSource;
  code: string | null;
  adUnitPath: string | null;
  height: number | null;
  devices: AdSlotDevice[];
  updatedAt: string | null;
}

export interface AdManagerVideoBreak {
  enabled: boolean;
  vastTagUrl: string | null;
}

export interface AdManagerOverview {
  emergencyStop: boolean;
  web: { masterEnabled: boolean; slots: AdManagerSlot[] };
  video: {
    masterEnabled: boolean;
    preRoll: AdManagerVideoBreak;
    midRoll: AdManagerVideoBreak & { everySec: number };
    postRoll: AdManagerVideoBreak;
    frequencyCapPerSession: number;
  };
}

export interface AdManagerSlotInput {
  enabled: boolean;
  source: Exclude<AdSlotSource, "HOUSE">;
  code: string | null;
  adUnitPath: string | null;
  height: number | null;
  devices: AdSlotDevice[];
}

export type AdManagerVideoInput = AdManagerOverview["video"];

export const gamAdUnitPathPattern = /^\/\d{1,20}(?:\/[A-Za-z0-9_.-]+)+$/u;

export function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Pulls a VAST tag out of whatever was pasted: a bare URL, or a snippet that contains one. */
export function extractVastTagUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isHttpsUrl(trimmed)) return trimmed;
  const match = trimmed.match(/https:\/\/[^\s"'<>]+/u);
  // A tag copied out of VAST XML keeps the CDATA terminator; Ad Manager macros keep their brackets.
  return match ? match[0].replace(/\]\]$/u, "").replaceAll("&amp;", "&") : trimmed;
}

/** Accepts "/1234/AYIN/home_top" or a pasted GPT snippet that contains the defineSlot path. */
export function extractAdUnitPath(value: string): string {
  const trimmed = value.trim();
  if (gamAdUnitPathPattern.test(trimmed)) return trimmed;
  const match = trimmed.match(/\/\d{1,20}(?:\/[A-Za-z0-9_.-]+)+/u);
  return match ? match[0] : trimmed;
}
