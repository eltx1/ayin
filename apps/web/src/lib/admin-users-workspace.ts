import {
  AdminWorkspaceError as AdminUsersError,
  adminObject as object,
  adminText as text,
  adminId as id,
  adminCount as count,
  adminDate as date,
  adminKnown as known,
  adminRows as rows,
  readAdminOperationsSession as session,
  assertSameAdminOperationsActor as match,
  adminWorkspaceRequest as request,
  boundedAdminRequest as bounded,
  canAdministerOperations as canManageUsers,
} from "./verified-admin-transport";
export {
  AdminWorkspaceError as AdminUsersError,
  canAdministerOperations as canManageUsers,
} from "./verified-admin-transport";
import type { AdminSession } from "./admin-control";

const invalid = () => new AdminUsersError();

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
