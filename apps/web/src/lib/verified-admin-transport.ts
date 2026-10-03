import { apiBaseUrl } from "./api";
import { adminVerificationRequired, readAdminApiError } from "./admin-reauthentication";
import type { AdminSession } from "./admin-control";

export class AdminWorkspaceError extends Error {
  constructor(
    readonly status = 0,
    readonly writeStarted = false,
    readonly verificationRequired = false,
  ) {
    super("Admin workspace could not be verified");
  }
}
const invalid = () => new AdminWorkspaceError();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function adminObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
export function adminText(value: unknown, max: number, min = 0) {
  if (typeof value !== "string" || value.length > max || value.trim().length < min) throw invalid();
  return value;
}
export function adminId(value: unknown) {
  const result = adminText(value, 36);
  if (!uuid.test(result)) throw invalid();
  return result;
}
export function adminCount(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw invalid();
  return value;
}
export function adminDate(value: unknown) {
  const result = adminText(value, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
export function adminKnown<const T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) throw invalid();
  return value as T[number];
}
export function adminRows<T>(value: unknown, max: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value.map(parse);
}
export function readAdminOperationsSession(value: unknown): AdminSession {
  const r = adminObject(value);
  const roles = adminRows(r.roles, 6, (value) =>
    adminKnown(value, [
      "SUPERADMIN",
      "ADMIN",
      "OPERATIONS",
      "CONTENT_MODERATOR",
      "AD_MANAGER",
      "FINANCE_MANAGER",
    ]),
  );
  if (!roles.length || new Set(roles).size !== roles.length) throw invalid();
  return { accountId: adminId(r.accountId), roles };
}
export function canAdministerOperations(roles: AdminSession["roles"]) {
  return roles.some((role) => ["SUPERADMIN", "ADMIN", "OPERATIONS"].includes(role));
}
export function assertSameAdminOperationsActor(expected: AdminSession, current: AdminSession) {
  if (
    expected.accountId !== current.accountId ||
    [...expected.roles].sort().join(",") !== [...current.roles].sort().join(",") ||
    !canAdministerOperations(current.roles)
  )
    throw new AdminWorkspaceError(403);
}
export async function adminWorkspaceRequest(
  path: string,
  signal: AbortSignal,
  init: RequestInit = {},
) {
  const response = await fetch(apiBaseUrl + path, {
    ...init,
    signal,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const verification = await adminVerificationRequired(response);
    await readAdminApiError(response);
    throw new AdminWorkspaceError(response.status, Boolean(init.method), verification);
  }
  return (await response.json()) as unknown;
}
export async function boundedAdminRequest<T>(
  signal: AbortSignal,
  ms: number,
  op: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, ms);
  try {
    return await op(controller.signal);
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
