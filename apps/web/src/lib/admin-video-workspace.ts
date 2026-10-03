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
  adminWorkspaceRequest as request,
  boundedAdminRequest as bounded,
} from "./verified-admin-transport";

export { AdminWorkspaceError as AdminVideoError } from "./verified-admin-transport";
export const videoStates = [
  "DRAFT",
  "UPLOADING",
  "VALIDATING",
  "SCHEDULED",
  "PUBLISHED",
  "REMOVED",
] as const;
export const videoEditableStates = ["DRAFT", "SCHEDULED", "PUBLISHED", "REMOVED"] as const;
export const videoVisibilities = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;
const invalid = () => new AdminWorkspaceError();
function boolean(value: unknown) {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function priority(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < -100000 ||
    value > 100000
  )
    throw invalid();
  return value;
}
export function canAdministerVideos(roles: AdminSession["roles"]) {
  return roles.some((role) =>
    ["SUPERADMIN", "ADMIN", "OPERATIONS", "CONTENT_MODERATOR"].includes(role),
  );
}
function match(expected: AdminSession, current: AdminSession) {
  if (
    expected.accountId !== current.accountId ||
    [...expected.roles].sort().join(",") !== [...current.roles].sort().join(",") ||
    !canAdministerVideos(current.roles)
  )
    throw new AdminWorkspaceError(403);
}
function parseTvControl(value: unknown) {
  if (value === null) return null;
  const r = object(value);
  const result = {
    id: id(r.id),
    name: text(r.name, 160, 1),
    status: known(r.status, ["ACTIVE", "OFF_AIR", "DISABLED"]),
    included: boolean(r.included),
    origin: known(r.origin, ["DEFAULT", "EXPLICIT"]),
    updatedAt: r.updatedAt === null ? null : date(r.updatedAt),
  };
  if (
    (result.origin === "DEFAULT" && (!result.included || result.updatedAt !== null)) ||
    (result.origin === "EXPLICIT" && result.updatedAt === null)
  )
    throw invalid();
  return result;
}
export function parseAdminVideo(value: unknown, expected?: string) {
  const r = object(value),
    c = object(r.channel),
    counts = object(r._count);
  const result = {
    id: id(r.id),
    slug: text(r.slug, 160, 1),
    title: text(r.title, 200, 1),
    description: r.description === null ? null : text(r.description, 20000),
    status: known(r.status, videoStates),
    visibility: known(r.visibility, videoVisibilities),
    videoForm: known(r.videoForm, ["LONG_FORM", "CLIP"]),
    commentsEnabled: boolean(r.commentsEnabled),
    publishedAt: r.publishedAt === null ? null : date(r.publishedAt),
    updatedAt: date(r.updatedAt),
    channel: {
      id: id(c.id),
      handle: text(c.handle, 80, 1),
      name: text(c.name, 120, 1),
      status: known(c.status, ["ACTIVE", "HIDDEN", "SUSPENDED", "REMOVED"]),
    },
    tvPreferences: rows(r.tvPreferences, 100, (value) => {
      const p = object(value);
      return {
        tvChannelId: id(p.tvChannelId),
        included: boolean(p.included),
        priority: priority(p.priority),
        sortOrder: p.sortOrder === null ? null : count(p.sortOrder, 1000000),
      };
    }),
    tvControl: parseTvControl(r.tvControl),
    counts: { comments: count(counts.comments), reports: count(counts.reports) },
  };
  if (
    (expected && result.id !== expected) ||
    new Set(result.tvPreferences.map((p) => p.tvChannelId)).size !== result.tvPreferences.length
  )
    throw invalid();
  return result;
}
export type AdminVideoRecord = ReturnType<typeof parseAdminVideo>;
export type VideoFilters = { query: string; status: string; visibility: string; page: number };
export function parseAdminVideoDirectory(value: unknown, filters: VideoFilters) {
  const r = object(value),
    p = object(r.pagination);
  const pagination = {
    page: count(p.page, 1000),
    take: count(p.take, 100),
    total: count(p.total),
    pages: count(p.pages),
  };
  const items = rows(r.items, 25, (value) => parseAdminVideo(value));
  if (
    pagination.page !== filters.page ||
    pagination.take !== 25 ||
    pagination.pages !== Math.max(1, Math.ceil(pagination.total / 25)) ||
    items.length !== Math.min(25, Math.max(0, pagination.total - (filters.page - 1) * 25)) ||
    new Set(items.map((item) => item.id)).size !== items.length ||
    items.some(
      (item) =>
        (filters.status && item.status !== filters.status) ||
        (filters.visibility && item.visibility !== filters.visibility),
    )
  )
    throw invalid();
  return { items, pagination };
}
export type AdminVideoSnapshot = {
  session: AdminSession;
  directory: ReturnType<typeof parseAdminVideoDirectory>;
};
export async function getAdminVideos(
  filters: VideoFilters,
  signal: AbortSignal,
  expected?: AdminSession,
): Promise<AdminVideoSnapshot> {
  return bounded(signal, 15000, async (signal) => {
    const first = session(await request("/admin/session", signal));
    if (!canAdministerVideos(first.roles)) throw new AdminWorkspaceError(403);
    if (expected) match(expected, first);
    const page = count(filters.page, 1000);
    if (page < 1) throw invalid();
    const params = new URLSearchParams({ page: String(page), take: "25" });
    if (filters.query.trim()) params.set("query", text(filters.query.trim(), 200));
    if (filters.status) params.set("status", known(filters.status, videoStates));
    if (filters.visibility) params.set("visibility", known(filters.visibility, videoVisibilities));
    const directory = parseAdminVideoDirectory(
      await request("/admin/control/videos?" + params, signal),
      filters,
    );
    match(first, session(await request("/admin/session", signal)));
    return { session: first, directory };
  });
}
export type AdminVideoCommand = {
  tvIncluded?: boolean | undefined;
  title: string;
  description: string;
  status: AdminVideoRecord["status"];
  visibility: AdminVideoRecord["visibility"];
  commentsEnabled: boolean;
  reason: string;
};
export function videoCommand(record: AdminVideoRecord, command: AdminVideoCommand) {
  if (record.status === "REMOVED") throw invalid();
  const tvIncluded = command.tvIncluded === undefined ? undefined : boolean(command.tvIncluded);
  if (tvIncluded !== undefined && !record.tvControl) throw invalid();
  const tvChanged = tvIncluded !== undefined && tvIncluded !== record.tvControl?.included;
  const title = text(command.title.trim(), 200, 1),
    description = text(command.description, 20000);
  const visibility = known(command.visibility, videoVisibilities),
    commentsEnabled = boolean(command.commentsEnabled);
  // Processing states may remain unchanged, but cannot be sent as an explicit transition.
  const status =
    command.status === record.status ? undefined : known(command.status, videoEditableStates);
  if (
    title === record.title &&
    description === (record.description ?? "") &&
    visibility === record.visibility &&
    commentsEnabled === record.commentsEnabled &&
    status === undefined &&
    !tvChanged
  )
    throw invalid();
  return {
    title,
    description: description || null,
    visibility,
    commentsEnabled,
    ...(status !== undefined ? { status } : {}),
    ...(tvChanged && record.tvControl
      ? {
          tvIncluded,
          expectedTvPreference: {
            tvChannelId: record.tvControl.id,
            updatedAt: record.tvControl.updatedAt,
          },
        }
      : {}),
    expectedUpdatedAt: date(record.updatedAt),
    reason: text(command.reason.trim(), 500, 8),
  };
}
export function parseAdminVideoAck(
  value: unknown,
  record: AdminVideoRecord,
  command: AdminVideoCommand,
) {
  const r = object(value);
  const result = {
    id: id(r.id),
    title: text(r.title, 200, 1),
    status: known(r.status, videoStates),
    visibility: known(r.visibility, videoVisibilities),
    commentsEnabled: boolean(r.commentsEnabled),
    updatedAt: date(r.updatedAt),
  };
  if (
    result.id !== record.id ||
    result.title !== command.title.trim() ||
    result.status !== command.status ||
    result.visibility !== command.visibility ||
    result.commentsEnabled !== command.commentsEnabled ||
    Date.parse(result.updatedAt) <= Date.parse(record.updatedAt)
  )
    throw invalid();
  const payload = videoCommand(record, command);
  if (payload.tvIncluded !== undefined && record.tvControl) {
    const tv = object(r.tvControl);
    const tvControl = {
      id: id(tv.id),
      included: boolean(tv.included),
      origin: known(tv.origin, ["EXPLICIT"]),
      updatedAt: date(tv.updatedAt),
    };
    if (
      tvControl.id !== record.tvControl.id ||
      tvControl.included !== (command.status === "REMOVED" ? false : command.tvIncluded) ||
      (record.tvControl.updatedAt !== null &&
        Date.parse(tvControl.updatedAt) <= Date.parse(record.tvControl.updatedAt))
    )
      throw invalid();
    return { ...result, tvControl };
  }
  return { ...result, tvControl: null };
}
export async function saveAdminVideo(
  actor: AdminSession,
  record: AdminVideoRecord,
  command: AdminVideoCommand,
  signal: AbortSignal,
) {
  const payload = videoCommand(record, command);
  return bounded(signal, 30000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    try {
      return parseAdminVideoAck(
        await request("/admin/control/videos/" + id(record.id), signal, {
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
export const videoBulkActions = ["UNPUBLISH", "DISABLE_COMMENTS", "ENABLE_COMMENTS"] as const;
export type VideoBulkAction = (typeof videoBulkActions)[number];
export async function bulkVerifiedAdminVideos(
  actor: AdminSession,
  records: AdminVideoRecord[],
  action: VideoBulkAction,
  reason: string,
  signal: AbortSignal,
) {
  if (
    !records.length ||
    records.length > 100 ||
    records.some((record) => record.status === "REMOVED") ||
    new Set(records.map((record) => record.id)).size !== records.length
  )
    throw invalid();
  const payload = {
    ids: records.map((record) => id(record.id)),
    action: known(action, videoBulkActions),
    reason: text(reason.trim(), 500, 8),
    expectedVideos: records.map((record) => ({
      id: id(record.id),
      updatedAt: date(record.updatedAt),
    })),
  };
  return bounded(signal, 30000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    try {
      const r = object(
        await request("/admin/control/videos/bulk", signal, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      const ack = {
        affected: count(r.affected, 100),
        action: known(r.action, videoBulkActions),
        ids: [...payload.ids],
      };
      if (ack.action !== action || ack.affected !== records.length) throw invalid();
      return ack;
    } catch (error) {
      if (error instanceof AdminWorkspaceError)
        throw new AdminWorkspaceError(error.status, true, error.verificationRequired);
      throw new AdminWorkspaceError(0, true);
    }
  });
}
export async function reviewAdminVideoTargets(
  actor: AdminSession,
  targetIds: string[],
  signal: AbortSignal,
) {
  const ids = targetIds.map((value) => id(value));
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw invalid();
  return bounded(signal, 15000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    const result: Array<{ id: string; record: AdminVideoRecord | null }> = [];
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const index = cursor++,
          targetId = ids[index]!;
        try {
          result[index] = {
            id: targetId,
            record: parseAdminVideo(
              await request("/admin/control/videos/" + targetId, signal),
              targetId,
            ),
          };
        } catch (error) {
          if (error instanceof AdminWorkspaceError && error.status === 404)
            result[index] = { id: targetId, record: null };
          else throw error;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, () => worker()));
    match(actor, session(await request("/admin/session", signal)));
    return result;
  });
}
export async function reviewAdminVideo(actor: AdminSession, targetId: string, signal: AbortSignal) {
  return bounded(signal, 15000, async (signal) => {
    match(actor, session(await request("/admin/session", signal)));
    let record: AdminVideoRecord | null;
    try {
      record = parseAdminVideo(
        await request("/admin/control/videos/" + id(targetId), signal),
        targetId,
      );
    } catch (error) {
      if (error instanceof AdminWorkspaceError && error.status === 404) record = null;
      else throw error;
    }
    match(actor, session(await request("/admin/session", signal)));
    return record;
  });
}
