import { apiBaseUrl } from "./api";
import { readAdminApiError } from "./admin-reauthentication";
import type { AdminSession, AdminRole } from "./admin-control";
export class AdminChannelsError extends Error {
  constructor(
    readonly status: number,
    readonly writeStarted = false,
  ) {
    super("Channel administration could not be verified");
  }
}
const invalid = () => new AdminChannelsError(0),
  uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid();
  return v as Record<string, unknown>;
}
function text(v: unknown, max: number, min = 0) {
  if (typeof v !== "string" || v.length > max || v.trim().length < min) throw invalid();
  return v;
}
function id(v: unknown) {
  const result = text(v, 36);
  if (!uuid.test(result)) throw invalid();
  return result;
}
function bool(v: unknown) {
  if (typeof v !== "boolean") throw invalid();
  return v;
}
function count(v: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max) throw invalid();
  return v;
}
function known<const T extends readonly string[]>(v: unknown, choices: T): T[number] {
  if (typeof v !== "string" || !choices.includes(v)) throw invalid();
  return v as T[number];
}
function nullable<T>(v: unknown, parse: (v: unknown) => T): T | null {
  return v === null ? null : parse(v);
}
function date(v: unknown) {
  const result = text(v, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function rows<T>(v: unknown, max: number, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max) throw invalid();
  return v.map(parse);
}
export const channelStates = ["ACTIVE", "HIDDEN", "SUSPENDED", "REMOVED"] as const,
  contractStates = ["PENDING", "ACTIVE", "SUSPENDED", "ENDED"] as const;
export function parseAdminChannelRecord(value: unknown, expectedId?: string) {
  const r = object(value);
  const result = {
    id: id(r.id),
    handle: text(r.handle, 100, 1),
    name: text(r.name, 120, 1),
    description: nullable(r.description, (v) => text(v, 20000)),
    status: known(r.status, channelStates),
    isPlatformOwned: bool(r.isPlatformOwned),
    updatedAt: date(r.updatedAt),
    creatorContracts: rows(r.creatorContracts, 1, (v) => {
      const c = object(v);
      return {
        id: id(c.id),
        status: known(c.status, contractStates),
        revenueShareBps: nullable(c.revenueShareBps, (v) => count(v, 10000)),
        effectiveFrom: nullable(c.effectiveFrom, date),
      };
    }),
  };
  if (expectedId && result.id !== expectedId) throw invalid();
  return result;
}
export type AdminChannelRecord = ReturnType<typeof parseAdminChannelRecord>;
export function parseAdminChannelDirectory(value: unknown, page: number) {
  const root = object(value),
    p = object(root.pagination),
    pagination = {
      total: count(p.total),
      page: count(p.page, 1000),
      take: count(p.take, 100),
      pages: count(p.pages),
    };
  if (
    pagination.page !== page ||
    pagination.take !== 25 ||
    pagination.pages !== Math.max(1, Math.ceil(pagination.total / pagination.take))
  )
    throw invalid();
  const items = rows(root.items, 25, (v) => {
    const r = object(v),
      counts = object(r._count);
    return {
      ...parseAdminChannelRecord(r),
      createdAt: date(r.createdAt),
      members: rows(r.members, 1, (v) => {
        const m = object(v),
          a = object(m.account);
        return {
          account: {
            id: id(a.id),
            email: text(a.email, 320, 1),
            displayName: text(a.displayName, 120, 1),
            status: known(a.status, ["ACTIVE", "SUSPENDED", "CLOSED"]),
          },
        };
      }),
      primaryTvChannel: nullable(r.primaryTvChannel, (v) => {
        const tv = object(v);
        return {
          id: id(tv.id),
          name: text(tv.name, 160, 1),
          status: known(tv.status, ["ACTIVE", "OFF_AIR", "DISABLED"]),
        };
      }),
      _count: {
        videos: count(counts.videos),
        subscriptions: count(counts.subscriptions),
        playlists: count(counts.playlists),
      },
    };
  });
  if (new Set(items.map((v) => v.id)).size !== items.length) throw invalid();
  return { items, pagination };
}
export type AdminChannelDirectory = ReturnType<typeof parseAdminChannelDirectory>;
function session(v: unknown): AdminSession {
  const r = object(v),
    roles = rows(r.roles, 6, (v) =>
      known(v, [
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
export function canManageChannels(roles: readonly AdminRole[]) {
  return roles.some((role) => ["SUPERADMIN", "ADMIN", "OPERATIONS"].includes(role));
}
function match(first: AdminSession, last: AdminSession) {
  if (
    first.accountId !== last.accountId ||
    [...first.roles].sort().join(",") !== [...last.roles].sort().join(",") ||
    !canManageChannels(last.roles)
  )
    throw new AdminChannelsError(403);
}
async function request(path: string, signal: AbortSignal, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    signal,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    await readAdminApiError(response);
    throw new AdminChannelsError(response.status, Boolean(init.method));
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
export type AdminChannelsSnapshot = { session: AdminSession; directory: AdminChannelDirectory };
export async function getAdminChannels(
  input: { query: string; status: string; page: number },
  signal: AbortSignal,
  expected?: AdminSession,
): Promise<AdminChannelsSnapshot> {
  return bounded(signal, 15000, async (signal) => {
    const first = session(await request("/admin/session", signal));
    if (!canManageChannels(first.roles)) throw new AdminChannelsError(403);
    if (expected) match(expected, first);
    const page = count(input.page, 1000);
    if (page < 1) throw invalid();
    const params = new URLSearchParams({ page: String(page), take: "25" });
    if (input.query.trim()) params.set("query", text(input.query.trim(), 200));
    if (input.status) params.set("status", known(input.status, channelStates));
    const directory = parseAdminChannelDirectory(
      await request(`/admin/control/channels?${params}`, signal),
      page,
    );
    match(first, session(await request("/admin/session", signal)));
    return { session: first, directory };
  });
}
export type AdminChannelDraft = {
  name: string;
  description: string;
  status: AdminChannelRecord["status"];
  contractStatus: AdminChannelRecord["creatorContracts"][number]["status"];
  revenueShareBps: string;
  isPlatformOwned: boolean;
  reason: string;
};
export function adminChannelInput(record: AdminChannelRecord, draft: AdminChannelDraft) {
  const name = text(draft.name.trim(), 120, 1),
    description = text(draft.description, 20000) || null,
    status = known(draft.status, channelStates),
    contractStatus = known(draft.contractStatus, contractStates),
    reason = text(draft.reason.trim(), 500, 3),
    raw = draft.revenueShareBps.trim();
  if (raw && !/^\d+$/.test(raw)) throw invalid();
  const revenueShareBps = raw ? count(Number(raw), 10000) : null,
    old = record.creatorContracts[0];
  if (status === "REMOVED" && status !== record.status) throw invalid();
  return {
    expectedUpdatedAt: record.updatedAt,
    reason,
    name,
    description,
    isPlatformOwned: bool(draft.isPlatformOwned),
    ...(status !== record.status
      ? { status: known(status, ["ACTIVE", "HIDDEN", "SUSPENDED"]) }
      : {}),
    ...(contractStatus !== (old?.status ?? "PENDING") ? { contractStatus } : {}),
    ...(revenueShareBps !== (old?.revenueShareBps ?? null) ? { revenueShareBps } : {}),
  };
}
export function verifyAdminChannelAck(
  value: unknown,
  record: AdminChannelRecord,
  input: ReturnType<typeof adminChannelInput>,
) {
  const result = parseAdminChannelRecord(value, record.id);
  if (
    result.name !== input.name ||
    result.description !== input.description ||
    result.isPlatformOwned !== input.isPlatformOwned ||
    (input.status !== undefined && result.status !== input.status) ||
    (input.contractStatus !== undefined &&
      result.creatorContracts[0]?.status !== input.contractStatus) ||
    (input.revenueShareBps !== undefined &&
      result.creatorContracts[0]?.revenueShareBps !== input.revenueShareBps)
  )
    throw new AdminChannelsError(0, true);
  return result;
}
export async function saveAdminChannel(
  actor: AdminSession,
  record: AdminChannelRecord,
  draft: AdminChannelDraft,
  signal: AbortSignal,
) {
  const input = adminChannelInput(record, draft);
  return bounded(signal, 30000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    try {
      return verifyAdminChannelAck(
        await request(`/admin/control/channels/${id(record.id)}`, signal, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
        record,
        input,
      );
    } catch (error) {
      if (error instanceof AdminChannelsError) throw new AdminChannelsError(error.status, true);
      throw error;
    }
  });
}
export async function reviewAdminChannel(
  actor: AdminSession,
  channelId: string,
  signal: AbortSignal,
): Promise<AdminChannelRecord | null> {
  return bounded(signal, 15000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    let result: AdminChannelRecord | null;
    try {
      result = parseAdminChannelRecord(
        await request(`/admin/control/channels/${id(channelId)}`, signal),
        channelId,
      );
    } catch (error) {
      if (error instanceof AdminChannelsError && error.status === 404) result = null;
      else throw error;
    }
    match(actor, session(await request("/admin/session", signal)));
    return result;
  });
}
