export interface AccountSession {
  id: string;
  current: boolean;
  status: "ACTIVE";
  deviceLabel: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid session response.");
  return value as Record<string, unknown>;
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const date = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function parseAccountSessions(value: unknown): AccountSession[] {
  const rows = record(value).sessions;
  if (!Array.isArray(rows)) throw Error("Invalid session list.");
  const sessions = rows.map((value) => {
    const row = record(value);
    if (
      typeof row.id !== "string" ||
      !uuid.test(row.id) ||
      typeof row.current !== "boolean" ||
      row.status !== "ACTIVE" ||
      typeof row.deviceLabel !== "string" ||
      !date(row.createdAt) ||
      !date(row.lastActiveAt) ||
      !date(row.expiresAt)
    )
      throw Error("Invalid session record.");
    return {
      id: row.id,
      current: row.current,
      status: "ACTIVE" as const,
      deviceLabel: row.deviceLabel,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
      expiresAt: row.expiresAt,
    };
  });
  if (
    new Set(sessions.map((row) => row.id)).size !== sessions.length ||
    sessions.filter((row) => row.current).length > 1
  )
    throw Error("Invalid session identities.");
  return sessions;
}
export function parseSessionRevoked(value: unknown, current: boolean): void {
  const row = record(value);
  if (row.revoked !== true || row.currentSessionRevoked !== current)
    throw Error("Unconfirmed session revocation.");
}
export function parseSessionsRevoked(value: unknown): number {
  const row = record(value);
  if (!count(row.revoked)) throw Error("Unconfirmed session revocation count.");
  return row.revoked;
}
export function parsePasswordChanged(value: unknown): void {
  const row = record(value);
  if (row.changed !== true || !count(row.otherSessionsRevoked))
    throw Error("Unconfirmed password change.");
}
