import { apiBaseUrl } from "./api";
import { readAdminApiError } from "./admin-reauthentication";
import type { AdminSession, AdminRole } from "./admin-control";
import {
  parseActorTrustActions,
  verifyAdminTrustAcknowledgment,
  type ActorTrustAction,
} from "./admin-trust-acknowledgment";
export class AdminTrustError extends Error {
  constructor(
    readonly status: number,
    readonly writeStarted = false,
  ) {
    super("Trust snapshot or operation could not be verified");
  }
}
const invalid = () => new AdminTrustError(0);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw invalid();
  return value;
}
function uuid(value: unknown) {
  const result = text(value, 36);
  if (!uuidPattern.test(result)) throw invalid();
  return result.toLowerCase();
}
function nullableId(value: unknown) {
  return value === null ? null : uuid(value);
}
function nullableText(value: unknown, max: number) {
  return value === null ? null : text(value, max, true);
}
function date(value: unknown) {
  const result = text(value, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function known<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw invalid();
  return value as T;
}
function bool(value: unknown) {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function rows<T extends { id: string }>(
  value: unknown,
  parse: (row: Record<string, unknown>) => T,
  max: number,
): T[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  const result = value.map((row) => parse(record(row)));
  if (new Set(result.map((row) => row.id)).size !== result.length) throw invalid();
  return result;
}
export const trustKinds = [
  "WARN",
  "STRIKE",
  "SUSPEND_ACCOUNT",
  "SUSPEND_CHANNEL",
  "UNPUBLISH_VIDEO",
  "REMOVE_VIDEO",
] as const;
export const trustLevels = ["NEW", "STANDARD", "TRUSTED", "RESTRICTED"] as const;
export const caseDecisions = ["REVIEWING", "ACTIONED", "DISMISSED", "CLOSED"] as const;
export const takedownDecisions = ["REVIEWING", "ACTIONED", "DISMISSED"] as const;
export const appealDecisions = ["REVIEWING", "UPHELD", "OVERTURNED"] as const;
const reportReasons = [
  "COPYRIGHT",
  "SPAM",
  "HARASSMENT",
  "HATE",
  "SEXUAL_CONTENT",
  "VIOLENCE",
  "MISLEADING",
  "OTHER",
] as const;
function report(row: Record<string, unknown>, openOnly = false) {
  const status = known(row.status, ["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"]);
  if (openOnly && !["OPEN", "REVIEWING"].includes(status)) throw invalid();
  return {
    id: uuid(row.id),
    status,
    reason: known(row.reason, reportReasons),
    details: nullableText(row.details, 4000),
    videoId: nullableId(row.videoId),
    commentId: nullableId(row.commentId),
    channelId: nullableId(row.channelId),
    createdAt: date(row.createdAt),
  };
}
function action(row: Record<string, unknown>) {
  return {
    id: uuid(row.id),
    kind: known(row.kind, trustKinds),
    reason: text(row.reason, 4000),
    targetAccountId: nullableId(row.targetAccountId),
    channelId: nullableId(row.channelId),
    videoId: nullableId(row.videoId),
    createdAt: date(row.createdAt),
  };
}
export function parseAdminTrustQueue(value: unknown) {
  const root = record(value);
  return {
    reports: rows(root.reports, (row) => report(row, true), 250),
    cases: rows(
      root.cases,
      (row) => ({
        id: uuid(row.id),
        status: known(row.status, ["OPEN", "REVIEWING"]),
        resolution: nullableText(row.resolution, 4000),
        summary: nullableText(row.summary, 10000),
        assignedToAccountId: nullableId(row.assignedToAccountId),
        createdAt: date(row.createdAt),
        reports: rows(row.reports, (r) => report(r), 5000),
      }),
      250,
    ),
    takedowns: rows(
      root.takedowns,
      (row) => ({
        id: uuid(row.id),
        status: known(row.status, ["OPEN", "REVIEWING"]),
        claimantName: text(row.claimantName, 160),
        contactEmail: text(row.contactEmail, 320),
        rightsBasis: text(row.rightsBasis, 120),
        details: text(row.details, 10000),
        videoId: nullableId(row.videoId),
        createdAt: date(row.createdAt),
      }),
      250,
    ),
    appeals: rows(
      root.appeals,
      (row) => {
        const linked = action(record(row.action));
        if (uuid(row.actionId) !== linked.id) throw invalid();
        return {
          id: uuid(row.id),
          actionId: linked.id,
          status: known(row.status, ["OPEN", "REVIEWING"]),
          message: text(row.message, 5000),
          createdAt: date(row.createdAt),
          action: linked,
        };
      },
      250,
    ),
  };
}
export type AdminTrustQueue = ReturnType<typeof parseAdminTrustQueue>;
export function parseAdminTrustSettings(value: unknown) {
  const root = record(value);
  if (!Array.isArray(root.blockedTerms) || root.blockedTerms.length > 500) throw invalid();
  return {
    blockedTerms: root.blockedTerms.map((value) => text(value, 100)),
    newCreatorsRequireReview: bool(root.newCreatorsRequireReview),
  };
}
export type AdminTrustSettings = ReturnType<typeof parseAdminTrustSettings>;
function session(value: unknown): AdminSession {
  const root = record(value);
  if (!Array.isArray(root.roles) || root.roles.length > 6) throw invalid();
  const roles = root.roles.map((value) =>
    known(value, [
      "SUPERADMIN",
      "ADMIN",
      "OPERATIONS",
      "CONTENT_MODERATOR",
      "AD_MANAGER",
      "FINANCE_MANAGER",
    ] as const),
  );
  if (!roles.length || new Set(roles).size !== roles.length) throw invalid();
  return { accountId: uuid(root.accountId), roles };
}
export function canManageTrustSettings(roles: readonly AdminRole[]) {
  return roles.some((role) => ["SUPERADMIN", "ADMIN", "OPERATIONS"].includes(role));
}
async function request(path: string, init: RequestInit, timeout: number): Promise<unknown> {
  const controller = new AbortController(),
    abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
    });
    if (!response.ok) {
      await readAdminApiError(response);
      throw new AdminTrustError(response.status, Boolean(init.method));
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}
export type AdminTrustSnapshot = {
  session: AdminSession;
  queue: AdminTrustQueue;
  settings: AdminTrustSettings;
  actions: ActorTrustAction[];
};
export async function getAdminTrust(signal: AbortSignal): Promise<AdminTrustSnapshot> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    init = { signal: bounded };
  const first = session(await request("/admin/session", init, 15000));
  if (
    !first.roles.some((role) =>
      ["SUPERADMIN", "ADMIN", "OPERATIONS", "CONTENT_MODERATOR"].includes(role),
    )
  )
    throw new AdminTrustError(403);
  const [queue, settings, actions] = await Promise.all([
    request("/admin/trust/queue", init, 15000),
    request("/admin/trust/settings", init, 15000),
    request("/admin/trust/actions", init, 15000),
  ]);
  const last = session(await request("/admin/session", init, 15000));
  if (
    bounded.aborted ||
    first.accountId !== last.accountId ||
    JSON.stringify([...first.roles].sort()) !== JSON.stringify([...last.roles].sort())
  )
    throw new AdminTrustError(401);
  return {
    session: last,
    queue: parseAdminTrustQueue(queue),
    settings: parseAdminTrustSettings(settings),
    actions: parseActorTrustActions(actions, last.accountId),
  };
}
export async function saveAdminTrust(
  path: string,
  method: "POST" | "PATCH" | "PUT",
  body: object,
  actor: string,
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  const current = session(await request("/admin/session", { signal: bounded }, 15000));
  if (
    current.accountId !== actor ||
    !current.roles.some((role) =>
      ["SUPERADMIN", "ADMIN", "OPERATIONS", "CONTENT_MODERATOR"].includes(role),
    ) ||
    (path === "/admin/trust/settings" && !canManageTrustSettings(current.roles))
  )
    throw new AdminTrustError(401);
  const result = await request(
    path,
    { method, body: JSON.stringify(body), signal: bounded },
    30000,
  );
  verifyAdminTrustAcknowledgment(path, result, body, actor);
}
export function adminActionInput(value: unknown) {
  const root = record(value),
    kind = known(root.kind, trustKinds),
    reason = text(root.reason, 4000).trim();
  if (reason.length < 10) throw invalid();
  const targets: Record<string, string> = {};
  for (const key of ["targetAccountId", "channelId", "videoId", "caseId"]) {
    const value = text(root[key] ?? "", 36, true).trim();
    if (value) targets[key] = uuid(value);
  }
  if (
    (kind === "SUSPEND_ACCOUNT" && !targets.targetAccountId) ||
    (["STRIKE", "SUSPEND_CHANNEL"].includes(kind) && !targets.channelId) ||
    (["UNPUBLISH_VIDEO", "REMOVE_VIDEO"].includes(kind) && !targets.videoId) ||
    (kind === "WARN" && !Object.keys(targets).length)
  )
    throw invalid();
  return { kind, reason, ...targets };
}

export type TrustReviewTarget = {
  kind: "cases" | "appeals" | "takedowns" | "channels";
  id: string;
};
export function parseTrustRecord(value: unknown, target: TrustReviewTarget) {
  const root = record(value),
    row = record(root.record);
  if (
    root.kind !== target.kind ||
    root.id !== target.id ||
    (target.kind === "channels" ? row.channelId : row.id) !== target.id
  )
    throw invalid();
  const updatedAt = date(row.updatedAt);
  if (target.kind === "channels") {
    if (
      typeof row.strikeCount !== "number" ||
      !Number.isSafeInteger(row.strikeCount) ||
      row.strikeCount < 0
    )
      throw invalid();
    return {
      ...target,
      updatedAt,
      state: known(row.level, trustLevels),
      resolution: null,
      reviewRequired: bool(row.reviewRequired),
      strikeCount: row.strikeCount,
    };
  }
  const choices =
    target.kind === "cases"
      ? ["OPEN", "REVIEWING", "ACTIONED", "DISMISSED", "CLOSED"]
      : target.kind === "appeals"
        ? ["OPEN", "REVIEWING", "UPHELD", "OVERTURNED"]
        : ["OPEN", "REVIEWING", "ACTIONED", "DISMISSED"];
  return {
    ...target,
    updatedAt,
    state: known(row.status, choices),
    resolution: nullableText(row.resolution, 4000),
    reviewRequired: null,
    strikeCount: null,
  };
}
export type TrustCurrentRecord =
  | ReturnType<typeof parseTrustRecord>
  | (TrustReviewTarget & {
      updatedAt: null;
      state: "NOT_FOUND";
      resolution: null;
      reviewRequired: null;
      strikeCount: null;
    });
export async function readTrustRecord(
  target: TrustReviewTarget,
  signal: AbortSignal,
): Promise<TrustCurrentRecord> {
  const id = uuid(target.id);
  known(target.kind, ["cases", "appeals", "takedowns", "channels"]);
  try {
    return parseTrustRecord(
      await request(`/admin/trust/records/${target.kind}/${id}`, { signal }, 15000),
      { ...target, id },
    );
  } catch (caught) {
    if (caught instanceof AdminTrustError && caught.status === 404)
      return {
        ...target,
        id,
        state: "NOT_FOUND",
        updatedAt: null,
        resolution: null,
        reviewRequired: null,
        strikeCount: null,
      };
    throw caught;
  }
}
