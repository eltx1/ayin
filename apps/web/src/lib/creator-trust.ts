import { apiBaseUrl } from "./api";
export class CreatorTrustRequestError extends Error {
  constructor(readonly status: number) {
    super("Trust request could not be verified");
  }
}
const invalid = () => new CreatorTrustRequestError(0);
const kinds = [
  "WARN",
  "STRIKE",
  "SUSPEND_ACCOUNT",
  "SUSPEND_CHANNEL",
  "UNPUBLISH_VIDEO",
  "REMOVE_VIDEO",
] as const;
const statuses = ["OPEN", "REVIEWING", "UPHELD", "OVERTURNED"] as const;
export type TrustAction = {
  id: string;
  kind: (typeof kinds)[number];
  reason: string;
  createdAt: string;
};
export type TrustAppeal = {
  id: string;
  actionId: string;
  status: (typeof statuses)[number];
  message: string;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  action: TrustAction;
};
export type CreatorTrustSnapshot = {
  accountId: string;
  channel: { id: string; name: string };
  actions: TrustAction[];
  appeals: TrustAppeal[];
  notices: Array<{
    id: string;
    title: string;
    body: string | null;
    createdAt: string;
    readAt: string | null;
  }>;
  trust: Array<{
    channelId: string;
    level: "NEW" | "STANDARD" | "TRUSTED" | "RESTRICTED";
    strikeCount: number;
    reviewRequired: boolean;
    updatedAt: string;
  }>;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result))
    throw invalid();
  return result;
}
function date(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function rows<T>(
  value: unknown,
  parse: (row: Record<string, unknown>) => T,
  key: (row: T) => string,
): T[] {
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  const result = value.map((v) => parse(record(v)));
  if (new Set(result.map(key)).size !== result.length) throw invalid();
  return result;
}
function action(row: Record<string, unknown>): TrustAction {
  const kind = text(row.kind, 32);
  if (!kinds.includes(kind as TrustAction["kind"])) throw invalid();
  return {
    id: id(row.id),
    kind: kind as TrustAction["kind"],
    reason: text(row.reason, 4000),
    createdAt: date(row.createdAt),
  };
}
function appeal(row: Record<string, unknown>, accountId: string): TrustAppeal {
  const status = text(row.status, 16),
    linked = action(record(row.action)),
    actionId = id(row.actionId);
  if (
    id(row.accountId) !== accountId ||
    linked.id !== actionId ||
    !statuses.includes(status as TrustAppeal["status"])
  )
    throw invalid();
  return {
    id: id(row.id),
    actionId,
    status: status as TrustAppeal["status"],
    message: text(row.message, 5000),
    resolution: row.resolution === null ? null : text(row.resolution, 4000),
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
    action: linked,
  };
}
export function parseCreatorTrust(value: unknown, identity: unknown): CreatorTrustSnapshot {
  const auth = record(identity),
    accountId = id(record(auth.account).id),
    channel = record(auth.channel),
    root = record(value);
  return {
    accountId,
    channel: { id: id(channel.id), name: text(channel.name, 120) },
    actions: rows(root.actions, action, (row) => row.id),
    appeals: rows(
      root.appeals,
      (row) => appeal(row, accountId),
      (row) => row.id,
    ),
    notices: rows(
      root.notices,
      (row) => {
        if (id(row.accountId) !== accountId || row.type !== "MODERATION") throw invalid();
        return {
          id: id(row.id),
          title: text(row.title, 200),
          body: row.body === null ? null : text(row.body, 20000, true),
          createdAt: date(row.createdAt),
          readAt: row.readAt === null ? null : date(row.readAt),
        };
      },
      (row) => row.id,
    ),
    trust: rows(
      root.trust,
      (row) => {
        const level = text(row.level, 16);
        if (
          !["NEW", "STANDARD", "TRUSTED", "RESTRICTED"].includes(level) ||
          typeof row.reviewRequired !== "boolean" ||
          typeof row.strikeCount !== "number" ||
          !Number.isSafeInteger(row.strikeCount) ||
          row.strikeCount < 0
        )
          throw invalid();
        return {
          channelId: id(row.channelId),
          level: level as CreatorTrustSnapshot["trust"][number]["level"],
          strikeCount: row.strikeCount,
          reviewRequired: row.reviewRequired,
          updatedAt: date(row.updatedAt),
        };
      },
      (row) => row.channelId,
    ),
  };
}
async function request(path: string, signal: AbortSignal, init: RequestInit = {}) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, init.method ? 30000 : 15000);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new CreatorTrustRequestError(response.status);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export async function getCreatorTrust(signal: AbortSignal) {
  const identity = await request("/auth/me", signal),
    data = await request("/trust/creator/history", signal),
    current = record(await request("/auth/me", signal));
  if (id(record(current.account).id) !== id(record(record(identity).account).id)) throw invalid();
  return parseCreatorTrust(data, identity);
}
export function appealInput(actionId: string, message: string) {
  const input = { actionId: id(actionId), message: message.trim() };
  if (input.message.length < 20 || input.message.length > 5000) throw invalid();
  return input;
}
export async function submitCreatorAppeal(
  accountId: string,
  input: ReturnType<typeof appealInput>,
  signal: AbortSignal,
) {
  const row = record(
    await request("/trust/appeals", signal, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  if (
    id(row.accountId) !== accountId ||
    id(row.actionId) !== input.actionId ||
    row.message !== input.message ||
    row.status !== "OPEN" ||
    row.resolution !== null
  )
    throw invalid();
  return { id: id(row.id), actionId: input.actionId, createdAt: date(row.createdAt) };
}
