import type { AdminRole, AdminSession } from "./admin-control";
const roles: AdminRole[] = [
  "SUPERADMIN",
  "ADMIN",
  "OPERATIONS",
  "CONTENT_MODERATOR",
  "AD_MANAGER",
  "FINANCE_MANAGER",
];
const invalid = () => new Error("Invalid administrative response");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 2000): string {
  if (typeof value !== "string" || value.length > maximum) throw invalid();
  return value;
}
function id(value: unknown) {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result))
    throw invalid();
  return result;
}
function number(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  )
    throw invalid();
  return value;
}
function count(value: unknown) {
  const result = number(value);
  if (!Number.isInteger(result)) throw invalid();
  return result;
}
function bool(value: unknown) {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function date(value: unknown) {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function list(value: unknown, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) throw invalid();
  return value as unknown[];
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw invalid();
  return value as T;
}
export function parseAdminSession(value: unknown): AdminSession {
  const row = object(value);
  const result = list(row.roles, 6).map((role) => choice(role, roles));
  if (!result.length || new Set(result).size !== result.length) throw invalid();
  return { accountId: id(row.accountId), roles: result };
}
export const dashboardCounterKeys = [
  "accounts",
  "activeAccounts",
  "channels",
  "videos",
  "publishedVideos",
  "tvChannels",
  "openReports",
  "openCases",
] as const;
export type DashboardCounters = Record<(typeof dashboardCounterKeys)[number], number>;
export function parseDashboardCounters(value: unknown): DashboardCounters {
  const row = object(value);
  return Object.fromEntries(
    dashboardCounterKeys.map((key) => [key, count(row[key])]),
  ) as DashboardCounters;
}
function milestone(value: unknown) {
  if (value === null) return null;
  const row = object(value),
    rate = number(row.retentionRate);
  if (rate > 1) throw invalid();
  return { retentionRate: rate };
}
export function parseDashboardAnalytics(value: unknown) {
  const row = object(value),
    range = object(row.dateRange),
    cohorts = object(row.cohorts);
  if (
    row.refresh !== "rollup" ||
    range.timezone !== "UTC" ||
    cohorts.identityScope !== "SIGNED_IN_PROFILE_PSEUDONYMS"
  )
    throw invalid();
  const minimumCohortSize = count(cohorts.minimumCohortSize);
  if (minimumCohortSize < 1) throw invalid();
  const retention = list(cohorts.retention, 400).map((value) => {
    const r = object(value),
      cohortSize = count(r.cohortSize);
    if (cohortSize < minimumCohortSize) throw invalid();
    return {
      cohortDate: date(r.cohortDate),
      cohortSize,
      d1: milestone(r.d1),
      d7: milestone(r.d7),
      d30: milestone(r.d30),
    };
  });
  const audienceDaily = list(cohorts.audienceDaily, 400).map((value) => {
    const r = object(value);
    return {
      date: date(r.date),
      newProfiles: count(r.newProfiles),
      returningProfiles: count(r.returningProfiles),
      sessionsPerActiveProfile: number(r.sessionsPerActiveProfile),
    };
  });
  return {
    dateRange: { from: date(range.from), to: date(range.to) },
    lastRollupCheck: row.lastRollupCheck === null ? null : date(row.lastRollupCheck),
    dauApprox: count(row.dauApprox),
    mauApprox: count(row.mauApprox),
    watchHours: number(row.watchHours),
    uploads: count(row.uploads),
    tvStarts: count(row.tvStarts),
    adEvents: count(row.adEvents),
    errors: count(row.errors),
    cohorts: { minimumCohortSize, retention, audienceDaily },
  };
}
export function parseDashboardHealth(value: unknown) {
  const row = object(value),
    api = object(row.api),
    database = object(row.database),
    storage = object(row.mediaStorage),
    background = object(row.backgroundProcessing);
  const processing = (value: unknown) => {
    const r = object(value);
    return { status: choice(r.status, ["NOT_CONFIGURED"] as const), reason: text(r.reason) };
  };
  return {
    checkedAt: date(row.checkedAt),
    api: choice(api.status, ["OK"] as const),
    database: choice(database.status, ["OK", "ERROR"] as const),
    storage: choice(storage.status, ["READY", "TEST", "DEVELOPMENT"] as const),
    storageMode: choice(storage.mode, ["r2", "development", "e2e"] as const),
    queues: processing(background.queues),
    workers: processing(background.workers),
  };
}
export function parseDashboardFinance(value: unknown) {
  const row = object(value),
    provider = object(row.externalProvider);
  return {
    pendingPayouts: count(row.pendingPayouts),
    processingPayouts: count(row.processingPayouts),
    openDisputes: count(row.openDisputes),
    mode: choice(row.mode, ["MANUAL_PAYOUT", "PROVIDER_AND_MANUAL_PAYOUT"] as const),
    externalProvidersConnected: bool(row.externalProvidersConnected),
    externalProvider: {
      provider: text(provider.provider, 80),
      connected: bool(provider.connected),
      productionEnabled: bool(provider.productionEnabled),
    },
    pendingValue: list(row.pendingValue, 180).map((value) => {
      const r = object(value),
        currency = text(r.currency, 3),
        amount = text(r.amount, 40);
      if (!/^[A-Z]{3}$/.test(currency) || !/^\d+(?:\.\d{1,6})?$/.test(amount)) throw invalid();
      return { currency, amount };
    }),
  };
}
const resultRoutes = {
  ACCOUNT: "/admin/users",
  CHANNEL: "/admin/channels",
  VIDEO: "/admin/videos",
  PAYOUT: "/admin/revenue/payouts/",
} as const;
export function parseDashboardSearch(value: unknown, query: string) {
  const row = object(value);
  if (row.query !== query) throw invalid();
  const items = list(row.items, 20).map((value) => {
    const r = object(value),
      kind = choice(r.kind, ["ACCOUNT", "CHANNEL", "VIDEO", "PAYOUT"] as const),
      itemId = id(r.id),
      href = text(r.href, 2048);
    const url = new URL(href, "https://ayin.stream");
    if (
      !href.startsWith("/admin/") ||
      url.origin !== "https://ayin.stream" ||
      url.hash ||
      url.username ||
      url.password ||
      url.pathname !== (kind === "PAYOUT" ? `${resultRoutes.PAYOUT}${itemId}` : resultRoutes[kind])
    )
      throw invalid();
    return { kind, id: itemId, href, label: text(r.label, 500), detail: text(r.detail, 1000) };
  });
  if (new Set(items.map((r) => `${r.kind}:${r.id}`)).size !== items.length) throw invalid();
  return items;
}
