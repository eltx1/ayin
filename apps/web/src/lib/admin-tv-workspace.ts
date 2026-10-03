import type { AdminSession } from "./admin-control";
import {
  AdminWorkspaceError,
  adminObject as object,
  adminText as text,
  adminId as id,
  adminDate as date,
  adminCount as count,
  adminKnown as known,
  adminRows as rows,
  readAdminOperationsSession as session,
  assertSameAdminOperationsActor as match,
  canAdministerOperations,
  adminWorkspaceRequest as request,
  boundedAdminRequest as bounded,
} from "./verified-admin-transport";
export { AdminWorkspaceError as AdminTvError } from "./verified-admin-transport";
export const tvStates = ["ACTIVE", "OFF_AIR", "DISABLED"] as const;
const invalid = () => new AdminWorkspaceError();
export function parseAdminTv(value: unknown, expected?: string) {
  const r = object(value),
    c = object(r.channel);
  const result = {
    id: id(r.id),
    slug: text(r.slug, 160, 1),
    name: text(r.name, 160, 1),
    status: known(r.status, tvStates),
    disabledAt: r.disabledAt === null ? null : date(r.disabledAt),
    updatedAt: date(r.updatedAt),
    channel: {
      id: id(c.id),
      handle: text(c.handle, 80, 1),
      name: text(c.name, 120, 1),
      status: known(c.status, ["ACTIVE", "HIDDEN", "SUSPENDED", "REMOVED"]),
    },
    scheduleItems: rows(r.scheduleItems, 2, (value) => {
      const i = object(value),
        v = object(i.video);
      const result = {
        id: id(i.id),
        startsAt: date(i.startsAt),
        endsAt: date(i.endsAt),
        status: known(i.status, ["SCHEDULED", "ACTIVE"]),
        video: { id: id(v.id), title: text(v.title, 200, 1) },
      };
      if (Date.parse(result.endsAt) <= Date.parse(result.startsAt)) throw invalid();
      return result;
    }),
  };
  if (expected && result.id !== expected) throw invalid();
  if (new Set(result.scheduleItems.map((i) => i.id)).size !== result.scheduleItems.length)
    throw invalid();
  return result;
}
export type AdminTvRecord = ReturnType<typeof parseAdminTv>;
export type TvFilters = { query: string; status: string; page: number };
export function parseAdminTvDirectory(value: unknown, filters: TvFilters) {
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
  const items = rows(r.items, 25, (value) => parseAdminTv(value));
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    (filters.status && items.some((item) => item.status !== filters.status)) ||
    items.length !== Math.min(25, Math.max(0, pagination.total - (filters.page - 1) * 25))
  )
    throw invalid();
  return { items, pagination };
}
export type AdminTvSnapshot = {
  session: AdminSession;
  directory: ReturnType<typeof parseAdminTvDirectory>;
};
export async function getAdminTv(
  filters: TvFilters,
  signal: AbortSignal,
  expected?: AdminSession,
): Promise<AdminTvSnapshot> {
  return bounded(signal, 15000, async (signal) => {
    const first = session(await request("/admin/session", signal));
    if (!canAdministerOperations(first.roles)) throw new AdminWorkspaceError(403);
    if (expected) match(expected, first);
    const page = count(filters.page, 1000);
    if (page < 1) throw invalid();
    const params = new URLSearchParams({ page: String(page), take: "25" });
    if (filters.query.trim()) params.set("query", text(filters.query.trim(), 200));
    if (filters.status) params.set("status", known(filters.status, tvStates));
    const directory = parseAdminTvDirectory(
      await request("/admin/control/tv?" + params, signal),
      filters,
    );
    match(first, session(await request("/admin/session", signal)));
    return { session: first, directory };
  });
}
export type AdminTvCommand = { status: AdminTvRecord["status"]; reason: string };
export function tvCommand(record: AdminTvRecord, command: AdminTvCommand) {
  const status = known(command.status, tvStates);
  if (record.status === status) throw invalid();
  return {
    status,
    reason: text(command.reason.trim(), 500, 8),
    expectedUpdatedAt: date(record.updatedAt),
  };
}
export function parseAdminTvAck(value: unknown, record: AdminTvRecord, command: AdminTvCommand) {
  const r = object(value),
    result = {
      id: id(r.id),
      name: text(r.name, 160, 1),
      status: known(r.status, tvStates),
      disabledAt: r.disabledAt === null ? null : date(r.disabledAt),
      updatedAt: date(r.updatedAt),
    };
  if (
    result.id !== record.id ||
    result.status !== command.status ||
    Date.parse(result.updatedAt) <= Date.parse(record.updatedAt) ||
    (result.status === "DISABLED") !== (result.disabledAt !== null)
  )
    throw invalid();
  return result;
}
export type AdminTvAck = ReturnType<typeof parseAdminTvAck>;
export async function saveAdminTv(
  actor: AdminSession,
  record: AdminTvRecord,
  command: AdminTvCommand,
  signal: AbortSignal,
) {
  const payload = tvCommand(record, command);
  return bounded(signal, 30000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    try {
      return parseAdminTvAck(
        await request("/admin/control/tv/" + id(record.id), signal, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        record,
        command,
      );
    } catch (error) {
      if (error instanceof AdminWorkspaceError)
        throw new AdminWorkspaceError(error.status, true, error.verificationRequired);
      throw new AdminWorkspaceError(0, true);
    }
  });
}
export async function reviewAdminTv(actor: AdminSession, targetId: string, signal: AbortSignal) {
  return bounded(signal, 15000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    let record: AdminTvRecord | null;
    try {
      record = parseAdminTv(await request("/admin/control/tv/" + id(targetId), signal), targetId);
    } catch (error) {
      if (error instanceof AdminWorkspaceError && error.status === 404) record = null;
      else throw error;
    }
    match(actor, session(await request("/admin/session", signal)));
    return record;
  });
}
