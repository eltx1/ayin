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

export { AdminWorkspaceError as AdminVideoAdError } from "./verified-admin-transport";
const invalid = () => new AdminWorkspaceError();
function boolean(v: unknown) {
  if (typeof v !== "boolean") throw invalid();
  return v;
}
function nullableBoolean(v: unknown) {
  return v === null ? null : boolean(v);
}
function url(v: unknown) {
  if (v === null) return null;
  const value = text(v, 4096, 1);
  try {
    new URL(value);
  } catch {
    throw invalid();
  }
  return value;
}
function interval(v: unknown) {
  const n = count(v, 7200);
  if (n < 60) throw invalid();
  return n;
}
export function canAdministerVideoAds(roles: AdminSession["roles"]) {
  return roles.some((r) => ["SUPERADMIN", "ADMIN", "AD_MANAGER"].includes(r));
}
function match(expected: AdminSession, current: AdminSession) {
  if (
    expected.accountId !== current.accountId ||
    [...expected.roles].sort().join(",") !== [...current.roles].sort().join(",") ||
    !canAdministerVideoAds(current.roles)
  )
    throw new AdminWorkspaceError(403);
}
export function parseVideoAdSettings(value: unknown) {
  const r = object(value);
  return {
    masterEnabled: boolean(r.masterEnabled),
    provider: known(r.provider, ["GOOGLE_IMA"]),
    preRollEnabled: boolean(r.preRollEnabled),
    midRollEnabled: boolean(r.midRollEnabled),
    postRollEnabled: boolean(r.postRollEnabled),
    midRollEverySec: interval(r.midRollEverySec),
    frequencyCapPerSession: count(r.frequencyCapPerSession, 50),
    externalVastTagUrl: url(r.externalVastTagUrl),
    houseCreativeUrl: url(r.houseCreativeUrl),
    houseClickUrl: url(r.houseClickUrl),
  };
}
export type VideoAdSettings = ReturnType<typeof parseVideoAdSettings>;
export function parseVideoAdSettingsRecord(value: unknown) {
  const r = object(value),
    source = known(r.source, ["DEFAULT", "STORED", "INVALID_STORED_DEFAULT"]),
    updatedAt = r.updatedAt === null ? null : date(r.updatedAt);
  if ((source === "DEFAULT") !== (updatedAt === null)) throw invalid();
  return { settings: parseVideoAdSettings(r.settings), source, updatedAt };
}
export type VideoAdSettingsRecord = ReturnType<typeof parseVideoAdSettingsRecord>;
function channel(value: unknown) {
  const r = object(value);
  return {
    id: id(r.id),
    name: text(r.name, 120, 1),
    handle: text(r.handle, 80, 1),
    status: known(r.status, ["ACTIVE", "HIDDEN", "SUSPENDED", "REMOVED"]),
  };
}
function video(value: unknown) {
  const r = object(value),
    c = object(r.channel);
  return {
    id: id(r.id),
    title: text(r.title, 200, 1),
    slug: text(r.slug, 160, 1),
    status: known(r.status, [
      "DRAFT",
      "UPLOADING",
      "VALIDATING",
      "SCHEDULED",
      "PUBLISHED",
      "REMOVED",
    ]),
    channel: { id: id(c.id), name: text(c.name, 120, 1), handle: text(c.handle, 80, 1) },
  };
}
export function parseVideoAdOverride(value: unknown) {
  const r = object(value),
    channelId = r.channelId === null ? null : id(r.channelId),
    videoId = r.videoId === null ? null : id(r.videoId);
  if (Boolean(channelId) === Boolean(videoId)) throw invalid();
  return {
    id: id(r.id),
    channelId,
    videoId,
    enabled: nullableBoolean(r.enabled),
    preRollEnabled: nullableBoolean(r.preRollEnabled),
    midRollEnabled: nullableBoolean(r.midRollEnabled),
    postRollEnabled: nullableBoolean(r.postRollEnabled),
    provider: r.provider === null ? null : known(r.provider, ["GOOGLE_IMA"]),
    vastTagUrl: url(r.vastTagUrl),
    midRollEverySec: r.midRollEverySec === null ? null : interval(r.midRollEverySec),
    updatedAt: date(r.updatedAt),
  };
}
export type VideoAdOverride = ReturnType<typeof parseVideoAdOverride>;
export type VideoAdValues = Pick<
  VideoAdOverride,
  | "enabled"
  | "preRollEnabled"
  | "midRollEnabled"
  | "postRollEnabled"
  | "provider"
  | "vastTagUrl"
  | "midRollEverySec"
>;
export function videoAdValues(row: VideoAdOverride | null): VideoAdValues {
  return {
    enabled: row?.enabled ?? null,
    preRollEnabled: row?.preRollEnabled ?? null,
    midRollEnabled: row?.midRollEnabled ?? null,
    postRollEnabled: row?.postRollEnabled ?? null,
    provider: row?.provider ?? null,
    vastTagUrl: row?.vastTagUrl ?? null,
    midRollEverySec: row?.midRollEverySec ?? null,
  };
}
export type AdTarget = { kind: "CHANNEL" | "VIDEO"; id: string };
export function parseVideoAdTarget(value: unknown, expected: AdTarget) {
  const r = object(value),
    kind = known(r.kind, ["CHANNEL", "VIDEO"]);
  const target = kind === "CHANNEL" ? channel(r.target) : video(r.target);
  if (kind !== expected.kind || target.id !== expected.id) throw invalid();
  const override = r.override === null ? null : parseVideoAdOverride(r.override);
  if (
    override &&
    (kind === "CHANNEL" ? override.channelId !== target.id : override.videoId !== target.id)
  )
    throw invalid();
  return { kind, target, override };
}
export type VideoAdTargetRecord = ReturnType<typeof parseVideoAdTarget>;
export type VideoAdFilters = { query: string; targetType: "" | "CHANNEL" | "VIDEO"; page: number };
function filtersQuery(filters: VideoAdFilters) {
  if (filters.page < 1 || count(filters.page, 1000) !== filters.page) throw invalid();
  text(filters.query, 200);
  known(filters.targetType, ["", "CHANNEL", "VIDEO"]);
  const q = new URLSearchParams({ page: String(filters.page) });
  if (filters.query.trim()) q.set("query", filters.query.trim());
  if (filters.targetType) q.set("targetType", filters.targetType);
  return q.toString();
}
export function parseVideoAdDirectory(value: unknown, filters: VideoAdFilters) {
  const r = object(value),
    p = object(r.pagination),
    page = count(p.page, 1000),
    take = count(p.take, 25),
    total = count(p.total),
    totalPages = count(p.totalPages),
    hasNext = boolean(p.hasNext);
  if (
    page !== filters.page ||
    take !== 25 ||
    totalPages !== Math.ceil(total / take) ||
    hasNext !== page * take < total
  )
    throw invalid();
  const items = rows(r.items, 25, (value) => {
    const raw = object(value),
      record = parseVideoAdOverride(raw),
      c = raw.channel === null ? null : channel(raw.channel),
      v = raw.video === null ? null : video(raw.video);
    if ((c && c.id !== record.channelId) || (v && v.id !== record.videoId)) throw invalid();
    return { ...record, channel: c, video: v };
  });
  if (
    items.length !== Math.min(take, Math.max(total - (page - 1) * take, 0)) ||
    new Set(items.map((x) => x.id)).size !== items.length
  )
    throw invalid();
  if (
    items.some((x) =>
      filters.targetType === "CHANNEL"
        ? !x.channelId
        : filters.targetType === "VIDEO"
          ? !x.videoId
          : false,
    )
  )
    throw invalid();
  return { items, pagination: { page, take, total, totalPages, hasNext } };
}
export type VideoAdDirectory = ReturnType<typeof parseVideoAdDirectory>;
async function actor(signal: AbortSignal, expected?: AdminSession) {
  const current = session(await request("/admin/session", signal));
  if (!canAdministerVideoAds(current.roles)) throw new AdminWorkspaceError(403);
  if (expected) match(expected, current);
  return current;
}
export function getVideoAdWorkspace(
  filters: VideoAdFilters,
  signal: AbortSignal,
  expected?: AdminSession,
) {
  const query = filtersQuery(filters);
  return bounded(signal, 15000, async (signal) => {
    const a = await actor(signal, expected);
    const [settings, directory] = await Promise.all([
      request("/admin/video-ads/settings/record", signal),
      request("/admin/video-ads/overrides/directory?" + query, signal),
    ]);
    const result = {
      actor: a,
      filters: { ...filters },
      settings: parseVideoAdSettingsRecord(settings),
      directory: parseVideoAdDirectory(directory, filters),
    };
    await actor(signal, a);
    return result;
  });
}
function targetPath(target: AdTarget) {
  id(target.id);
  known(target.kind, ["CHANNEL", "VIDEO"]);
  return (
    "/admin/video-ads/" +
    (target.kind === "CHANNEL" ? "channels/" : "videos/") +
    encodeURIComponent(target.id)
  );
}
export function reviewVideoAdTarget(a: AdminSession, target: AdTarget, signal: AbortSignal) {
  const path = targetPath(target);
  return bounded(signal, 15000, async (signal) => {
    await actor(signal, a);
    let result: VideoAdTargetRecord | null;
    try {
      result = parseVideoAdTarget(await request(path + "/record", signal), target);
    } catch (e) {
      if (!(e instanceof AdminWorkspaceError) || e.status !== 404) throw e;
      result = null;
    }
    await actor(signal, a);
    return result;
  });
}
export function reviewVideoAdSettings(a: AdminSession, signal: AbortSignal) {
  return bounded(signal, 15000, async (signal) => {
    await actor(signal, a);
    const r = parseVideoAdSettingsRecord(await request("/admin/video-ads/settings/record", signal));
    await actor(signal, a);
    return r;
  });
}
export function searchVideoAdTargets(a: AdminSession, query: string, signal: AbortSignal) {
  text(query, 200, 2);
  return bounded(signal, 15000, async (signal) => {
    await actor(signal, a);
    const r = object(
      await request(
        "/admin/operations/directory/advertising-targets?query=" + encodeURIComponent(query.trim()),
        signal,
      ),
    );
    const channels = rows(r.channels, 12, channel),
      videos = rows(r.videos, 12, video);
    if (
      new Set(channels.map((x) => x.id)).size !== channels.length ||
      new Set(videos.map((x) => x.id)).size !== videos.length
    )
      throw invalid();
    await actor(signal, a);
    return { channels, videos };
  });
}
export type VideoAdCommand =
  | { kind: "SETTINGS"; original: VideoAdSettingsRecord; settings: VideoAdSettings }
  | { kind: "OVERRIDE" | "DELETE"; original: VideoAdTargetRecord; values: VideoAdValues };
export type VideoAdAck =
  | { kind: "SETTINGS"; record: VideoAdSettingsRecord }
  | { kind: "OVERRIDE"; target: AdTarget; record: VideoAdOverride }
  | { kind: "DELETE"; target: AdTarget; deleted: boolean };
export function saveVideoAdCommand(a: AdminSession, command: VideoAdCommand, signal: AbortSignal) {
  const target =
    command.kind === "SETTINGS"
      ? null
      : { kind: command.original.kind, id: command.original.target.id };
  const path = target ? targetPath(target) : "/admin/video-ads/settings";
  let payload: Record<string, unknown>;
  let expectedValues: VideoAdValues | undefined;
  if (command.kind === "SETTINGS") {
    const original = parseVideoAdSettingsRecord(command.original),
      settings = parseVideoAdSettings(command.settings);
    if (JSON.stringify(original.settings) === JSON.stringify(settings)) throw invalid();
    payload = { ...settings, expectedUpdatedAt: original.updatedAt };
  } else {
    if (!target) throw invalid();
    const original = parseVideoAdTarget(command.original, target);
    if (command.kind === "DELETE") {
      if (!original.override) throw invalid();
      payload = { expectedUpdatedAt: original.override.updatedAt };
    } else {
      const values = videoAdValues(
        parseVideoAdOverride({
          ...command.values,
          id: original.override?.id ?? target.id,
          channelId: target.kind === "CHANNEL" ? target.id : null,
          videoId: target.kind === "VIDEO" ? target.id : null,
          updatedAt: original.override?.updatedAt ?? new Date(0).toISOString(),
        }),
      );
      if (
        original.override &&
        JSON.stringify(videoAdValues(original.override)) === JSON.stringify(values)
      )
        throw invalid();
      expectedValues = values;
      payload = { ...values, expectedUpdatedAt: original.override?.updatedAt ?? null };
    }
  }
  return bounded(signal, 30000, async (signal) => {
    let started = false;
    try {
      await actor(signal, a);
      started = true;
      const raw = await request(path, signal, {
        method: command.kind === "DELETE" ? "DELETE" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (command.kind === "SETTINGS") {
        const record = parseVideoAdSettingsRecord(raw);
        if (
          record.source !== "STORED" ||
          record.updatedAt === null ||
          Date.parse(record.updatedAt) <=
            Date.parse(command.original.updatedAt ?? new Date(0).toISOString()) ||
          JSON.stringify(record.settings) !== JSON.stringify(parseVideoAdSettings(command.settings))
        )
          throw invalid();
        return { kind: "SETTINGS", record } as VideoAdAck;
      }
      if (!target) throw invalid();
      if (command.kind === "DELETE") {
        const deleted = boolean(object(raw).deleted);
        if (!deleted) throw invalid();
        return { kind: "DELETE", target, deleted } as VideoAdAck;
      }
      const record = parseVideoAdOverride(raw);
      if (
        (target.kind === "CHANNEL"
          ? record.channelId !== target.id
          : record.videoId !== target.id) ||
        Date.parse(record.updatedAt) <=
          Date.parse(command.original.override?.updatedAt ?? new Date(0).toISOString()) ||
        (command.original.override && record.id !== command.original.override.id) ||
        JSON.stringify(videoAdValues(record)) !== JSON.stringify(expectedValues)
      )
        throw invalid();
      return { kind: "OVERRIDE", target, record } as VideoAdAck;
    } catch (e) {
      if (e instanceof AdminWorkspaceError)
        throw new AdminWorkspaceError(e.status, started, e.verificationRequired);
      throw new AdminWorkspaceError(0, started);
    }
  });
}
