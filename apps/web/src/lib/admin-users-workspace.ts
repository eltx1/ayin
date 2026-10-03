import { apiBaseUrl } from "./api";
import { adminVerificationRequired, readAdminApiError } from "./admin-reauthentication";
import type { AdminSession } from "./admin-control";

export class AdminUsersError extends Error {
  constructor(
    readonly status = 0,
    readonly writeStarted = false,
    readonly verificationRequired = false,
  ) {
    super("Account administration could not be verified");
  }
}
const invalid = () => new AdminUsersError();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, min = 0) {
  if (typeof value !== "string" || value.length > max || value.trim().length < min) throw invalid();
  return value;
}
function id(value: unknown) {
  const result = text(value, 36);
  if (!uuid.test(result)) throw invalid();
  return result;
}
function count(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw invalid();
  return value;
}
function date(value: unknown) {
  const result = text(value, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function known<const T extends readonly string[]>(value: unknown, choices: T): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) throw invalid();
  return value as T[number];
}
function rows<T>(value: unknown, max: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value.map(parse);
}
export const accountStates = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;
export function parseAdminUser(value: unknown, expected?: string) {
  const r = object(value);
  const result = {
    id: id(r.id),
    email: text(r.email, 320, 1),
    displayName: text(r.displayName, 120, 1),
    status: known(r.status, accountStates),
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
    emailVerifiedAt: r.emailVerifiedAt === null ? null : date(r.emailVerifiedAt),
    channelMemberships: rows(r.channelMemberships, 3, (value) => {
      const c = object(object(value).channel);
      return {
        channel: {
          id: id(c.id),
          handle: text(c.handle, 100, 1),
          name: text(c.name, 120, 1),
          status: known(c.status, ["ACTIVE", "HIDDEN", "SUSPENDED", "REMOVED"]),
        },
      };
    }),
  };
  if (expected && result.id !== expected) throw invalid();
  if (
    new Set(result.channelMemberships.map((m) => m.channel.id)).size !==
    result.channelMemberships.length
  )
    throw invalid();
  return result;
}
export type AdminUserRecord = ReturnType<typeof parseAdminUser>;
export type UserFilters = { query: string; status: string; page: number };
export function parseAdminUsers(value: unknown, filters: UserFilters) {
  const r = object(value),
    p = object(r.pagination);
  const pagination = {
    page: count(p.page, 1000),
    take: count(p.take, 100),
    total: count(p.total),
    pages: count(p.pages),
  };
  if (
    pagination.page !== filters.page ||
    pagination.take !== 25 ||
    pagination.pages !== Math.max(1, Math.ceil(pagination.total / 25))
  )
    throw invalid();
  const items = rows(r.items, 25, (value) => parseAdminUser(value));
  if (
    new Set(items.map((r) => r.id)).size !== items.length ||
    items.length !== Math.max(0, Math.min(25, pagination.total - (filters.page - 1) * 25)) ||
    (filters.status && items.some((r) => r.status !== filters.status))
  )
    throw invalid();
  return { items, pagination };
}
function session(value: unknown): AdminSession {
  const r = object(value);
  const roles = rows(r.roles, 6, (value) =>
    known(value, [
      "SUPERADMIN",
      "ADMIN",
      "OPERATIONS",
      "CONTENT_MODERATOR",
      "AD_MANAGER",
      "FINANCE_MANAGER",
    ]),
  );
  if (!roles.length || new Set(roles).size !== roles.length) throw invalid();
  return { accountId: id(r.accountId), roles };
}
export function canManageUsers(roles: AdminSession["roles"]) {
  return roles.some((role) => ["SUPERADMIN", "ADMIN", "OPERATIONS"].includes(role));
}
function match(expected: AdminSession, current: AdminSession) {
  if (
    expected.accountId !== current.accountId ||
    [...expected.roles].sort().join(",") !== [...current.roles].sort().join(",") ||
    !canManageUsers(current.roles)
  )
    throw new AdminUsersError(403);
}
async function request(path: string, signal: AbortSignal, init: RequestInit = {}) {
  const response = await fetch(apiBaseUrl + path, {
    ...init,
    signal,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const verification = await adminVerificationRequired(response);
    await readAdminApiError(response);
    throw new AdminUsersError(response.status, Boolean(init.method), verification);
  }
  return (await response.json()) as unknown;
}
async function bounded<T>(
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
export type AdminUsersSnapshot = {
  session: AdminSession;
  directory: ReturnType<typeof parseAdminUsers>;
};
export async function getAdminUsers(
  filters: UserFilters,
  signal: AbortSignal,
  expected?: AdminSession,
): Promise<AdminUsersSnapshot> {
  return bounded(signal, 15000, async (signal) => {
    const first = session(await request("/admin/session", signal));
    if (!canManageUsers(first.roles)) throw new AdminUsersError(403);
    if (expected) match(expected, first);
    const page = count(filters.page, 1000);
    if (page < 1) throw invalid();
    const params = new URLSearchParams({ page: String(page), take: "25" });
    if (filters.query.trim()) params.set("query", text(filters.query.trim(), 200));
    if (filters.status) params.set("status", known(filters.status, accountStates));
    const directory = parseAdminUsers(
      await request("/admin/control/users?" + params, signal),
      filters,
    );
    match(first, session(await request("/admin/session", signal)));
    return { session: first, directory };
  });
}
export type AdminUserCommand =
  | { kind: "name"; displayName: string }
  | { kind: "status"; status: "ACTIVE" | "SUSPENDED"; reason: string }
  | { kind: "sessions"; reason: string };
export type AdminUserAck = {
  kind: AdminUserCommand["kind"];
  id: string;
  email: string;
  displayName: string;
  authVersion: number;
  status: AdminUserRecord["status"] | null;
  updatedAt: string | null;
  sessionsRevoked: boolean;
};
export function userCommand(record: AdminUserRecord, command: AdminUserCommand) {
  const expectedUpdatedAt = record.updatedAt;
  if (command.kind === "name")
    return { displayName: text(command.displayName.trim(), 120, 1), expectedUpdatedAt };
  const reason = text(command.reason.trim(), 500, 8);
  if (command.kind === "sessions") return { reason, expectedUpdatedAt };
  if (record.status === "CLOSED" || record.status === command.status) throw invalid();
  return { status: known(command.status, ["ACTIVE", "SUSPENDED"]), reason, expectedUpdatedAt };
}
export function parseAdminUserAck(
  value: unknown,
  record: AdminUserRecord,
  command: AdminUserCommand,
): AdminUserAck {
  const r = object(value),
    result: AdminUserAck = {
      kind: command.kind,
      id: id(r.id),
      email: text(r.email, 320, 1),
      displayName: text(r.displayName, 120, 1),
      authVersion: count(r.authVersion),
      status: null,
      updatedAt: null,
      sessionsRevoked: false,
    };
  if (result.id !== record.id || result.email !== record.email) throw invalid();
  if (command.kind === "sessions") {
    if (r.sessionsRevoked !== true || result.authVersion < 1) throw invalid();
    result.sessionsRevoked = true;
  } else {
    result.status = known(r.status, accountStates);
    result.updatedAt = date(r.updatedAt);
    if (command.kind === "name" && result.displayName !== command.displayName.trim())
      throw invalid();
    if (command.kind === "status" && result.status !== command.status) throw invalid();
  }
  return result;
}
export async function saveAdminUser(
  actor: AdminSession,
  record: AdminUserRecord,
  command: AdminUserCommand,
  signal: AbortSignal,
) {
  const payload = userCommand(record, command);
  return bounded(signal, 30000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    const path =
      command.kind === "sessions"
        ? "/admin/operations/accounts/" + id(record.id) + "/revoke-sessions"
        : "/admin/control/users/" + id(record.id);
    try {
      return parseAdminUserAck(
        await request(path, signal, {
          method: command.kind === "sessions" ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        record,
        command,
      );
    } catch (error) {
      if (error instanceof AdminUsersError)
        throw new AdminUsersError(error.status, true, error.verificationRequired);
      throw new AdminUsersError(0, true);
    }
  });
}
export async function reviewAdminUser(actor: AdminSession, accountId: string, signal: AbortSignal) {
  return bounded(signal, 15000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    let record: AdminUserRecord | null;
    try {
      record = parseAdminUser(
        await request("/admin/control/users/" + id(accountId), signal),
        accountId,
      );
    } catch (error) {
      if (error instanceof AdminUsersError && error.status === 404) record = null;
      else throw error;
    }
    match(actor, session(await request("/admin/session", signal)));
    return record;
  });
}
