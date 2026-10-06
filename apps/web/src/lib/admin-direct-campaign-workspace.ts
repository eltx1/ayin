import {
  parseDirectAdminSession,
  sameAdminSessionScope,
  type DirectAdminSession,
} from "./admin-session-scope";
import type { Advertiser, Campaign, CampaignInput } from "./admin-advertising";
import {
  canAdministerVideoAds,
  parseVideoAdChannel,
  parseVideoAdVideo,
} from "./admin-video-ad-workspace";
import {
  AdminWorkspaceError,
  adminObject as object,
  adminText as text,
  adminId as id,
  adminDate as date,
  adminCount as count,
  adminKnown as known,
  adminRows as rows,
  adminWorkspaceRequest as request,
  boundedAdminRequest as bounded,
} from "./verified-admin-transport";

export { AdminWorkspaceError } from "./verified-admin-transport";
export type AdvertiserRecord = Advertiser & { updatedAt: string };
export type CampaignRecord = Campaign & { updatedAt: string };
export type DirectKind = "advertiser" | "campaign";
export type DirectRecord = AdvertiserRecord | CampaignRecord;
export type DirectCommand = {
  mutationId: string;
  kind: DirectKind;
  action: "create" | "update" | "delete";
  original: DirectRecord | null;
  values: Record<string, unknown>;
};
export type DirectAcknowledgment = {
  mutationId: string;
  actorAccountId: string;
  action: string;
  entityType: "Advertiser" | "Campaign";
  entityId: string;
  updatedAt: string;
};
export type DirectOutcome = { acknowledgment: DirectAcknowledgment; record: DirectRecord | null };
export class DirectWriteError extends AdminWorkspaceError {
  constructor(
    status: number,
    writeStarted: boolean,
    verificationRequired: boolean,
    readonly acknowledged: DirectOutcome | null,
    code = "",
  ) {
    super(status, writeStarted, verificationRequired, code);
  }
}
const invalid = () => new AdminWorkspaceError();
const statuses = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;
function decimal(value: unknown) {
  const result = text(value, 40, 1);
  if (!/^\d+(?:\.\d{1,6})?$/.test(result)) throw invalid();
  return result;
}
function nullable<T>(value: unknown, parse: (value: unknown) => T) {
  return value === null ? null : parse(value);
}
export function parseAdvertiser(value: unknown): AdvertiserRecord {
  const r = object(value);
  return {
    id: id(r.id),
    name: text(r.name, 160, 2),
    status: known(r.status, ["ACTIVE", "PAUSED", "DISABLED"]),
    updatedAt: date(r.updatedAt),
  };
}
export function parseDirectConfig(value: unknown): NonNullable<Campaign["direct"]> {
  const r = object(value),
    p = object(r.pricing),
    t = object(r.targeting);
  const model = known(p.model, ["CPM", "FIXED"]);
  if ((model === "CPM" ? p.fixedPrice : p.cpm) !== null) throw invalid();
  const priority = count(r.priority, 1000);
  if (priority < 1) throw invalid();
  const impressionGoal = nullable(r.impressionGoal, count);
  if (impressionGoal === 0) throw invalid();
  const targeting: NonNullable<Campaign["direct"]>["targeting"] = {};
  for (const key of ["placementKeys", "countries", "regions", "categories"] as const) {
    if (t[key] !== undefined) {
      targeting[key] = rows(t[key], 1000000, (value) =>
        text(value, key === "countries" ? 2 : 120, key === "countries" ? 2 : 1),
      );
    }
  }
  if (t.devices !== undefined)
    targeting.devices = rows(t.devices, 1000000, (value) =>
      known(value, ["MOBILE", "DESKTOP", "TV"]),
    );
  if (t.channelIds !== undefined) targeting.channelIds = rows(t.channelIds, 1000000, id);
  if (t.videoIds !== undefined) targeting.videoIds = rows(t.videoIds, 1000000, id);
  return {
    priority,
    pricing:
      model === "CPM"
        ? { model, cpm: decimal(p.cpm), fixedPrice: null }
        : { model, cpm: null, fixedPrice: decimal(p.fixedPrice) },
    impressionGoal,
    frequencyCap: count(r.frequencyCap, 100),
    pacing: known(r.pacing, ["EVEN", "ASAP"]),
    targeting,
  };
}
export function parseCampaign(value: unknown): CampaignRecord {
  const r = object(value);
  return {
    id: id(r.id),
    advertiserId: id(r.advertiserId),
    name: text(r.name, 160, 2),
    status: known(r.status, statuses),
    startsAt: nullable(r.startsAt, date),
    endsAt: nullable(r.endsAt, date),
    budget: nullable(r.budget, decimal),
    currency: nullable(r.currency, (v) => text(v, 3, 3)),
    advertiser: { name: text(object(r.advertiser).name, 160, 2) },
    direct: nullable(r.direct, parseDirectConfig),
    updatedAt: date(r.updatedAt),
  };
}
export function parseDirectWorkspace(value: unknown) {
  const r = object(value);
  const advertisers = rows(r.advertisers, 1000000, parseAdvertiser);
  const campaigns = rows(r.campaigns, 1000000, parseCampaign);
  if (
    new Set(advertisers.map((r) => r.id)).size !== advertisers.length ||
    new Set(campaigns.map((r) => r.id)).size !== campaigns.length
  )
    throw invalid();
  const byId = new Map(advertisers.map((r) => [r.id, r]));
  if (campaigns.some((r) => byId.get(r.advertiserId)?.name !== r.advertiser.name)) throw invalid();
  return { advertisers, campaigns };
}
const headers = (actor: DirectAdminSession) => ({
  "x-ayin-expected-account": id(actor.accountId),
  "x-ayin-expected-session": id(actor.sessionId),
});
function match(expected: DirectAdminSession, current: DirectAdminSession) {
  if (!sameAdminSessionScope(expected, current) || !canAdministerVideoAds(current.roles))
    throw new AdminWorkspaceError(403);
}
async function actor(signal: AbortSignal, expected?: DirectAdminSession) {
  const result = parseDirectAdminSession(
    await request("/admin/session", signal, expected ? { headers: headers(expected) } : {}),
  );
  if (!canAdministerVideoAds(result.roles)) throw new AdminWorkspaceError(403);
  if (expected) match(expected, result);
  return result;
}
export class DirectReadError extends AdminWorkspaceError {
  constructor(
    error: unknown,
    readonly identityUnverified: boolean,
    readonly acknowledgment: DirectAcknowledgment | null = null,
  ) {
    super(
      error instanceof AdminWorkspaceError ? error.status : 0,
      false,
      false,
      error instanceof AdminWorkspaceError ? error.code : "",
    );
  }
}
async function scopedRead<T>(
  signal: AbortSignal,
  expected: DirectAdminSession | undefined,
  read: (a: DirectAdminSession) => Promise<T>,
) {
  let a: DirectAdminSession;
  try {
    a = await actor(signal, expected);
  } catch (error) {
    throw new DirectReadError(error, true);
  }
  let result: { value: T } | undefined;
  let failure: unknown;
  try {
    result = { value: await read(a) };
  } catch (error) {
    failure = error;
  }
  try {
    await actor(signal, a);
  } catch (error) {
    throw new DirectReadError(error, true);
  }
  if (!result)
    throw new DirectReadError(
      failure,
      failure instanceof AdminWorkspaceError &&
        ([401, 403].includes(failure.status) ||
          ["ACCOUNT_CHANGED", "SESSION_CHANGED"].includes(failure.code)),
    );
  return { actor: a, value: result.value };
}
export function readDirectWorkspace(signal: AbortSignal, expected?: DirectAdminSession) {
  return bounded(signal, 15000, async (signal) => {
    const result = await scopedRead(signal, expected, async (a) =>
      parseDirectWorkspace(
        await request("/admin/advertising/workspace", signal, { headers: headers(a) }),
      ),
    );
    return { actor: result.actor, ...result.value };
  });
}
function commandAction(command: DirectCommand) {
  return `${command.kind.toUpperCase()}_${command.action === "create" ? "CREATED" : command.action === "update" ? "UPDATED" : "DELETED"}`;
}
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}
function sameValue(key: string, actual: unknown, expected: unknown): boolean {
  if (
    ["budget", "cpm", "fixedPrice"].includes(key) &&
    typeof actual === "string" &&
    typeof expected === "string"
  ) {
    const canonical = (v: string) =>
      v
        .replace(/^0+(?=\d)/, "")
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, "");
    return canonical(actual) === canonical(expected);
  }
  if (
    ["startsAt", "endsAt"].includes(key) &&
    typeof actual === "string" &&
    typeof expected === "string"
  )
    return Date.parse(actual) === Date.parse(expected);
  if (
    actual &&
    expected &&
    typeof actual === "object" &&
    typeof expected === "object" &&
    !Array.isArray(expected)
  ) {
    return Object.entries(expected).every(([k, v]) =>
      sameValue(k, (actual as Record<string, unknown>)[k], v),
    );
  }
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}
export function parseDirectOutcome(
  raw: unknown,
  a: DirectAdminSession,
  command: DirectCommand,
): DirectOutcome {
  const r = object(raw),
    ack = object(r.acknowledgment);
  const acknowledgment: DirectAcknowledgment = {
    mutationId: id(ack.mutationId),
    actorAccountId: id(ack.actorAccountId),
    action: text(ack.action, 30, 1),
    entityType: known(ack.entityType, ["Advertiser", "Campaign"]),
    entityId: id(ack.entityId),
    updatedAt: date(ack.updatedAt),
  };
  if (
    acknowledgment.mutationId !== command.mutationId ||
    acknowledgment.actorAccountId !== a.accountId ||
    acknowledgment.action !== commandAction(command) ||
    acknowledgment.entityType !== (command.kind === "advertiser" ? "Advertiser" : "Campaign") ||
    (command.original && acknowledgment.entityId !== command.original.id)
  )
    throw invalid();
  if (
    command.original &&
    (command.action === "delete"
      ? Date.parse(acknowledgment.updatedAt) !== Date.parse(command.original.updatedAt)
      : Date.parse(acknowledgment.updatedAt) <= Date.parse(command.original.updatedAt))
  )
    throw invalid();
  const record =
    r.record === null
      ? null
      : command.kind === "advertiser"
        ? parseAdvertiser(r.record)
        : parseCampaign(r.record);
  if (command.action === "delete") {
    if (record !== null) throw invalid();
  } else {
    if (
      !record ||
      record.id !== acknowledgment.entityId ||
      record.updatedAt !== acknowledgment.updatedAt
    )
      throw invalid();
    if (
      Object.entries(command.values).some(
        ([k, v]) =>
          !["expectedAdvertiserUpdatedAt"].includes(k) &&
          !sameValue(k, (record as unknown as Record<string, unknown>)[k], v),
      )
    )
      throw invalid();
  }
  return { acknowledgment, record };
}
export function saveDirectCommand(
  a: DirectAdminSession,
  command: DirectCommand,
  signal: AbortSignal,
) {
  id(command.mutationId);
  if (command.action !== "create" && !command.original) throw invalid();
  const path =
    "/admin/advertising/" +
    (command.kind === "advertiser" ? "advertisers" : "campaigns") +
    (command.original ? "/" + id(command.original.id) : "");
  return bounded(signal, 30000, async (signal) => {
    let started = false;
    let acknowledged: DirectOutcome | null = null;
    try {
      await actor(signal, a);
      started = true;
      acknowledged = parseDirectOutcome(
        await request(path, signal, {
          method:
            command.action === "create" ? "POST" : command.action === "delete" ? "DELETE" : "PATCH",
          headers: { ...headers(a), "content-type": "application/json" },
          body: JSON.stringify({
            ...command.values,
            mutationId: command.mutationId,
            ...(command.original ? { expectedUpdatedAt: command.original.updatedAt } : {}),
          }),
        }),
        a,
        command,
      );
      await actor(signal, a);
      return acknowledged;
    } catch (error) {
      if (error instanceof AdminWorkspaceError)
        throw new DirectWriteError(
          error.status,
          started,
          error.verificationRequired,
          acknowledged,
          error.code,
        );
      throw new DirectWriteError(0, started, false, acknowledged);
    }
  });
}
export function searchDirectTargets(a: DirectAdminSession, query: string, signal: AbortSignal) {
  text(query.trim(), 200, 2);
  return bounded(signal, 15000, async (signal) => {
    const result = await scopedRead(signal, a, async () => {
      const raw = object(
        await request(
          "/admin/operations/directory/advertising-targets?query=" +
            encodeURIComponent(query.trim()),
          signal,
          { headers: headers(a) },
        ),
      );
      const channels = rows(raw.channels, 12, parseVideoAdChannel),
        videos = rows(raw.videos, 12, parseVideoAdVideo);
      if (
        new Set(channels.map((r) => r.id)).size !== channels.length ||
        new Set(videos.map((r) => r.id)).size !== videos.length
      )
        throw invalid();
      return { channels, videos };
    });
    return result.value;
  });
}
export type DirectWorkspace = Awaited<ReturnType<typeof readDirectWorkspace>>;
export type CampaignValues = CampaignInput;

export function reviewDirectCommand(
  a: DirectAdminSession,
  command: DirectCommand,
  signal: AbortSignal,
) {
  return bounded(signal, 15000, async (signal) => {
    let acknowledged: DirectAcknowledgment | null = null;
    try {
      const result = await scopedRead(signal, a, async () => {
        let raw: Record<string, unknown>;
        try {
          raw = object(
            await request("/admin/advertising/mutations/" + id(command.mutationId), signal, {
              headers: headers(a),
            }),
          );
        } catch (error) {
          if (error instanceof AdminWorkspaceError && error.status === 404) return null;
          throw error;
        }
        const ack = object(raw.acknowledgment);
        const result: DirectAcknowledgment = {
          mutationId: id(ack.mutationId),
          actorAccountId: id(ack.actorAccountId),
          action: text(ack.action, 30, 1),
          entityType: known(ack.entityType, ["Advertiser", "Campaign"]),
          entityId: id(ack.entityId),
          updatedAt: date(ack.updatedAt),
        };
        if (
          result.mutationId !== command.mutationId ||
          result.actorAccountId !== a.accountId ||
          result.action !== commandAction(command) ||
          result.entityType !== (command.kind === "advertiser" ? "Advertiser" : "Campaign") ||
          (command.original && result.entityId !== command.original.id)
        )
          throw invalid();
        acknowledged = result;
        return result;
      });
      return result.value;
    } catch (error) {
      if (error instanceof DirectReadError)
        throw new DirectReadError(error, error.identityUnverified, acknowledged);
      throw error;
    }
  });
}
