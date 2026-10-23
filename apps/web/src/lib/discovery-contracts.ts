import type { DiscoveryHomeResponse, DiscoverySpotlight } from "./discovery";
import { parseDiscoveryItem, parseDiscoveryRow } from "./my-ayin-contracts";

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseSpotlight(value: unknown): DiscoverySpotlight | null {
  if (value === undefined || value === null) return null;
  const item = parseDiscoveryItem(value);
  const raw = value as Record<string, unknown>;
  if (
    item.type !== "VIDEO" ||
    !nullableText(raw.description) ||
    !nullableText(raw.channelName) ||
    !(
      raw.durationMs === null ||
      (typeof raw.durationMs === "number" &&
        Number.isSafeInteger(raw.durationMs) &&
        raw.durationMs >= 0)
    )
  )
    throw new Error("INVALID_DISCOVERY_HOME");
  return {
    ...item,
    description: raw.description,
    channelName: raw.channelName,
    durationMs: raw.durationMs,
  };
}

// Accept the previous rows-only contract during a rolling deployment. Supplied
// new fields are validated, never guessed when malformed. Eligibility remains
// authoritative on the API; this boundary validates safe display/link shapes.
export function parseDiscoveryHome(value: unknown): DiscoveryHomeResponse {
  if (!value || typeof value !== "object") throw new Error("INVALID_DISCOVERY_HOME");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.rows) || raw.rows.length > 100) throw new Error("INVALID_DISCOVERY_HOME");
  const rows = raw.rows.map(parseDiscoveryRow);
  if (new Set(rows.map((row) => row.key)).size !== rows.length)
    throw new Error("INVALID_DISCOVERY_HOME");
  if (raw.mode !== undefined && raw.mode !== "AUTO" && raw.mode !== "MANAGED")
    throw new Error("INVALID_DISCOVERY_HOME");
  if (
    raw.status !== undefined &&
    raw.status !== "READY" &&
    raw.status !== "EMPTY" &&
    raw.status !== "DISABLED"
  )
    throw new Error("INVALID_DISCOVERY_HOME");
  const spotlight = parseSpotlight(raw.spotlight);
  const hasContent = Boolean(spotlight || rows.some((row) => row.items.length));
  const mode = raw.mode ?? "MANAGED";
  const status = raw.status ?? (hasContent ? "READY" : "EMPTY");
  if (
    (status === "READY") !== hasContent ||
    (status === "DISABLED" && mode !== "MANAGED") ||
    (spotlight && mode !== "AUTO")
  )
    throw new Error("INVALID_DISCOVERY_HOME");
  return {
    mode,
    status: status as DiscoveryHomeResponse["status"],
    spotlight,
    rows,
    // Kids policy is informational here; the dedicated endpoint owns filtering.
    ...(raw.policy && typeof raw.policy === "object"
      ? { policy: raw.policy as NonNullable<DiscoveryHomeResponse["policy"]> }
      : {}),
  };
}
