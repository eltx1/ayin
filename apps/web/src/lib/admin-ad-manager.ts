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
    midRoll: AdManagerVideoBreak & {
      mode: "INTERVAL" | "CUE_POINTS";
      everySec: number;
      cuePointsSec: number[];
      maxBreaks: number;
    };
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

/**
 * Parses "5:00, 20:00, 1:05:00" (or bare minutes "5, 20, 65") into sorted unique seconds.
 * Returns null when any entry is not a time.
 */
export function parseCueTimes(text: string): number[] | null {
  const parts = text
    .split(/[,،;\s]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const seconds: number[] = [];
  for (const part of parts) {
    if (/^\d+(?:\.\d+)?$/u.test(part)) {
      seconds.push(Math.round(Number(part) * 60));
      continue;
    }
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/u.exec(part);
    if (!match) return null;
    const [, h, m, s] = match;
    if (Number(s) > 59 || (h !== undefined && Number(m) > 59)) return null;
    seconds.push(Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s));
  }
  const unique = [...new Set(seconds)].filter((value) => value >= 10 && value <= 86_400);
  if (unique.length !== new Set(seconds).size) return null;
  return unique.sort((a, b) => a - b).slice(0, 50);
}

/** Same rule as the API: interval or fixed cues, capped, never in the last 30 seconds. */
export function previewCuePoints(
  midRoll: {
    mode: "INTERVAL" | "CUE_POINTS";
    everySec: number;
    cuePointsSec: number[];
    maxBreaks: number;
  },
  durationSec: number,
): number[] {
  const last = durationSec - 30;
  if (last <= 0) return [];
  if (midRoll.mode === "CUE_POINTS")
    return [...midRoll.cuePointsSec].filter((cue) => cue <= last).slice(0, midRoll.maxBreaks);
  const cues: number[] = [];
  for (
    let cue = midRoll.everySec;
    cue <= last && cues.length < midRoll.maxBreaks;
    cue += midRoll.everySec
  )
    cues.push(cue);
  return cues;
}

export type VastCheckStatus = "FILLED" | "NO_FILL" | "AD_RULES" | "NOT_VAST" | "UNREADABLE";

/** Requests a VAST tag the way the player would and reports what came back. */
export async function checkVastTag(
  tag: string,
  slot: "PRE_ROLL" | "MID_ROLL" | "POST_ROLL",
  fetcher: typeof fetch = fetch,
  origin = typeof window === "undefined" ? "https://ayin.stream" : window.location.origin,
): Promise<{ status: VastCheckStatus; ads: number }> {
  const { fillVastRequestMacros } = await import("./vast-request-macros");
  const description = encodeURIComponent(`${origin}/`);
  let url = fillVastRequestMacros(
    tag
      .replaceAll("[placeholder]", description)
      .replaceAll("[description_url]", description)
      .replaceAll("[DESCRIPTION_URL]", description),
  );
  try {
    const parsed = new URL(url);
    if (/(^|\.)doubleclick\.net$/u.test(parsed.hostname) && parsed.pathname.includes("/gampad/")) {
      parsed.searchParams.set("ad_rule", "0");
      parsed.searchParams.set(
        "vpos",
        slot === "PRE_ROLL" ? "preroll" : slot === "MID_ROLL" ? "midroll" : "postroll",
      );
      url = parsed.toString();
    }
  } catch {
    return { status: "NOT_VAST", ads: 0 };
  }
  let body: string;
  try {
    const response = await fetcher(url, { credentials: "include", cache: "no-store" });
    body = await response.text();
  } catch {
    return { status: "UNREADABLE", ads: 0 };
  }
  const xml = body
    .replace(/^\uFEFF/u, "")
    .replace(/<\?xml[^>]*\?>/u, "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .trim();
  const root = /^<([A-Za-z_][\w:.-]*)/u.exec(xml)?.[1]?.split(":").pop()?.toLowerCase();
  if (root === "vmap") return { status: "AD_RULES", ads: 0 };
  if (root !== "vast") return { status: "NOT_VAST", ads: 0 };
  const ads = xml.match(/<Ad[\s>]/gu)?.length ?? 0;
  return { status: ads > 0 ? "FILLED" : "NO_FILL", ads };
}
