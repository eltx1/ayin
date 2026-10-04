import { apiBaseUrl } from "./api";
import type {
  CreatorComplianceView,
  CreatorPaymentProfile,
  CreatorRevenueOverview,
  CreatorMonetizationAnalytics,
  RevenueDispute,
} from "./revenue";

export class CreatorFinanceError extends Error {
  constructor(
    readonly status: number,
    readonly writeStarted = false,
    readonly scopeChanged = false,
    readonly acknowledged = false,
  ) {
    super("Creator finance request could not be verified");
  }
}
const invalid = () => new CreatorFinanceError(0);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 5000, min = 0): string {
  if (typeof value !== "string" || value.length > max || value.trim().length < min) throw invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (!uuid.test(result)) throw invalid();
  return result;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function number(value: unknown, max = Number.MAX_SAFE_INTEGER, integer = true): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    throw invalid();
  return value;
}
function choice<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw invalid();
  return value as T[number];
}
function date(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function rows<T>(value: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 10000) throw invalid();
  return value.map(parse);
}
function unique<T>(values: T[], key: (value: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) throw invalid();
  return values;
}
function currency(value: unknown): string {
  const result = text(value, 3);
  if (!/^[A-Z]{3}$/.test(result)) throw invalid();
  return result;
}
export function financeAmount(value: unknown): string {
  const result = text(value, 64);
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(result)) throw invalid();
  return result;
}
export function exactFinanceMoney(code: string, value: string): string {
  const validated = financeAmount(value),
    [whole = "0", fraction = ""] = validated.split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${currency(code)} ${whole}.${trimmed}`;
}
const statuses = ["NOT_STARTED", "PENDING", "VERIFIED", "REQUIRES_ACTION", "REJECTED"] as const;
function channel(value: unknown) {
  const r = object(value);
  return { id: id(r.id), name: text(r.name, 160, 1), handle: text(r.handle, 100, 1) };
}
export function parseFinanceCompliance(value: unknown, channelId: string): CreatorComplianceView {
  const r = object(value),
    p = object(r.provider),
    requirements = object(r.requirements),
    identity = object(r.identity),
    tax = object(r.tax),
    destination = object(r.payoutDestination);
  if (id(r.channelId) !== channelId) throw invalid();
  return {
    channelId,
    provider: {
      name: text(p.name, 64, 1),
      connected: bool(p.connected),
      productionEnabled: bool(p.productionEnabled),
      externalIdentityWorkflow: bool(p.externalIdentityWorkflow),
      externalTaxWorkflow: bool(p.externalTaxWorkflow),
    },
    requirements: {
      identityRequired: bool(requirements.identityRequired),
      taxRequired: bool(requirements.taxRequired),
      payoutDestinationVerificationRequired: bool(
        requirements.payoutDestinationVerificationRequired,
      ),
      source: choice(requirements.source, ["NONE", "PROVIDER", "APPROVED_LEGAL_CONFIGURATION"]),
      version: nullable(requirements.version, (v) => text(v, 160)),
    },
    identity: {
      status: choice(identity.status, statuses),
      required: bool(identity.required),
      actionAvailable: bool(identity.actionAvailable),
    },
    tax: {
      status: choice(tax.status, statuses),
      required: bool(tax.required),
      actionAvailable: bool(tax.actionAvailable),
    },
    payoutDestination: {
      status: choice(destination.status, statuses),
      required: bool(destination.required),
      configured: bool(destination.configured),
      masked: nullable(destination.masked, (v) => text(v, 1500)),
    },
    payoutComplianceEligible: bool(r.payoutComplianceEligible),
    actionsRequired: rows(r.actionsRequired, (v) => text(v, 1000, 1)),
    lastCheckedAt: nullable(r.lastCheckedAt, date),
  };
}
export function parseFinanceProfile(value: unknown, channelId: string): CreatorPaymentProfile {
  const r = object(value);
  if (id(r.channelId) !== channelId) throw invalid();
  const country = nullable(r.countryCode, (v) => text(v, 2));
  if (country !== null && !/^[A-Z]{2}$/.test(country)) throw invalid();
  return {
    id: id(r.id),
    channelId,
    legalName: text(r.legalName, 160, 2),
    preferredCurrency: currency(r.preferredCurrency),
    provider: text(r.provider, 64, 2),
    destinationMask: nullable(r.destinationMask, (v) => text(v, 1500)),
    countryCode: country,
    identityStatus: choice(r.identityStatus, statuses),
    taxStatus: choice(r.taxStatus, statuses),
    payoutDestinationStatus: choice(r.payoutDestinationStatus, statuses),
    complianceProvider: nullable(r.complianceProvider, (v) => text(v, 64)),
    complianceLastCheckedAt: nullable(r.complianceLastCheckedAt, date),
    hasDestination: bool(r.hasDestination),
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
  };
}
export function parseFinanceOverview(value: unknown, channelId: string): CreatorRevenueOverview {
  const r = object(value),
    c = channel(r.channel),
    contract = object(r.contract),
    readiness = object(r.payoutReadiness),
    eligibility = object(r.payoutEligibility),
    connection = object(r.providerConnection),
    external = object(connection.externalProvider);
  if (c.id !== channelId) throw invalid();
  return {
    channel: c,
    contract: {
      source: choice(contract.source, ["CHANNEL_OVERRIDE", "ADMIN_DEFAULT"]),
      contractId: nullable(contract.contractId, id),
      revenueShareBps: number(contract.revenueShareBps, 10000),
      effectiveFrom: nullable(contract.effectiveFrom, date),
      effectiveTo: nullable(contract.effectiveTo, date),
    },
    currency: currency(r.currency),
    estimatedRevenue: financeAmount(r.estimatedRevenue),
    finalizedRevenue: financeAmount(r.finalizedRevenue),
    availableForPayout: financeAmount(r.availableForPayout),
    onHoldForPayout: financeAmount(r.onHoldForPayout),
    payoutThreshold: financeAmount(r.payoutThreshold),
    payoutProgressPercent: number(r.payoutProgressPercent, 100, false),
    canRequestPayout: bool(r.canRequestPayout),
    payoutReadiness: {
      profileReady: bool(readiness.profileReady),
      thresholdMet: bool(readiness.thresholdMet),
      openPayout: bool(readiness.openPayout),
      providerReady: bool(readiness.providerReady),
      complianceReady: bool(readiness.complianceReady),
    },
    compliance: parseFinanceCompliance(r.compliance, channelId),
    payoutEligibility: {
      eligible: bool(eligibility.eligible),
      actionsRequired: rows(eligibility.actionsRequired, (v) => text(v, 1000, 1)),
    },
    paymentProfile: nullable(r.paymentProfile, (v) => parseFinanceProfile(v, channelId)),
    providerConnection: {
      activeProvider: text(connection.activeProvider, 64, 1),
      manualPayoutEnabled: bool(connection.manualPayoutEnabled),
      externalProvidersConnected: bool(connection.externalProvidersConnected),
      externalProvider: {
        provider: text(external.provider, 64, 1),
        connected: bool(external.connected),
        productionEnabled: bool(external.productionEnabled),
      },
    },
    byVideo: unique(
      rows(r.byVideo, (v) => {
        const x = object(v);
        return {
          videoId: id(x.videoId),
          title: text(x.title, 500),
          estimated: financeAmount(x.estimated),
          finalized: financeAmount(x.finalized),
        };
      }),
      (x) => x.videoId,
    ),
    byPeriod: unique(
      rows(r.byPeriod, (v) => {
        const x = object(v);
        return {
          period: text(x.period, 100, 1),
          estimated: financeAmount(x.estimated),
          finalized: financeAmount(x.finalized),
        };
      }),
      (x) => x.period,
    ),
    recentLedger: unique(
      rows(r.recentLedger, (v) => {
        const x = object(v);
        return {
          id: id(x.id),
          state: text(x.state, 64, 1),
          type: text(x.type, 64, 1),
          amount: financeAmount(x.amount),
          currency: currency(x.currency),
          memo: nullable(x.memo, (v) => text(v, 5000)),
          occurredAt: date(x.occurredAt),
          video: nullable(x.video, (v) => {
            const y = object(v);
            return { title: text(y.title, 500), slug: text(y.slug, 200) };
          }),
        };
      }),
      (x) => x.id,
    ),
    payouts: unique(
      rows(r.payouts, (v) => {
        const x = object(v);
        return {
          id: id(x.id),
          status: choice(x.status, ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED"]),
          amount: financeAmount(x.amount),
          currency: currency(x.currency),
          requestedAt: date(x.requestedAt),
          processedAt: nullable(x.processedAt, date),
          paidAt: nullable(x.paidAt, date),
        };
      }),
      (x) => x.id,
    ),
  };
}
export function parseFinanceAnalytics(
  value: unknown,
  channelId: string,
): CreatorMonetizationAnalytics {
  const r = object(value),
    c = channel(r.channel),
    countries = object(r.countryRevenueAttribution);
  if (
    c.id !== channelId ||
    countries.available !== false ||
    !Array.isArray(countries.rows) ||
    countries.rows.length
  )
    throw invalid();
  return {
    channel: c,
    currency: currency(r.currency),
    mixedCurrency: bool(r.mixedCurrency),
    windowDays: number(r.windowDays, 366),
    videoStarts: number(r.videoStarts),
    monetizedAdStarts: number(r.monetizedAdStarts),
    creatorRpm: nullable(r.creatorRpm, financeAmount),
    creatorCpm: nullable(r.creatorCpm, financeAmount),
    finalizedRevenue30d: financeAmount(r.finalizedRevenue30d),
    byDay: unique(
      rows(r.byDay, (v) => {
        const x = object(v),
          day = text(x.day, 10);
        if (
          !/^\d{4}-\d\d-\d\d$/.test(day) ||
          new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
        )
          throw invalid();
        return {
          day,
          estimated: financeAmount(x.estimated),
          finalized: financeAmount(x.finalized),
        };
      }),
      (x) => x.day,
    ),
    byAdSource: unique(
      rows(r.byAdSource, (v) => {
        const x = object(v);
        return {
          source: text(x.source, 200, 1),
          estimated: financeAmount(x.estimated),
          finalized: financeAmount(x.finalized),
        };
      }),
      (x) => x.source,
    ),
    countryRevenueAttribution: { available: false, reason: text(countries.reason, 2000), rows: [] },
    estimatedPayoutDate: nullable(r.estimatedPayoutDate, date),
    payoutTimingReason: text(r.payoutTimingReason, 2000),
  };
}
export function parseFinanceDispute(value: unknown, channelId: string): RevenueDispute {
  const r = object(value);
  if (id(r.channelId) !== channelId) throw invalid();
  return {
    id: id(r.id),
    channelId,
    payoutId: nullable(r.payoutId, id),
    category: choice(r.category, ["EARNINGS", "PAYOUT", "OTHER"]),
    message: text(r.message, 5000, 20),
    status: choice(r.status, ["OPEN", "REVIEWING", "RESOLVED", "REJECTED"]),
    resolution: nullable(r.resolution, (v) => text(v, 5000)),
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
    resolvedAt: nullable(r.resolvedAt, date),
  };
}
export type FinanceSnapshot = {
  accountId: string;
  overview: CreatorRevenueOverview;
  analytics: CreatorMonetizationAnalytics;
  disputes: RevenueDispute[];
};
async function request(
  path: string,
  signal: AbortSignal,
  init: RequestInit = {},
  expectedAccountId?: string,
) {
  const headers = new Headers(init.headers);
  if (expectedAccountId) headers.set("x-ayin-expected-account", expectedAccountId);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
      signal,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new CreatorFinanceError(0, Boolean(init.method));
  }
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null);
    const code =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).error
        : null;
    const changed =
      code &&
      typeof code === "object" &&
      !Array.isArray(code) &&
      (code as Record<string, unknown>).code === "ACCOUNT_CHANGED";
    throw new CreatorFinanceError(
      response.status,
      Boolean(init.method),
      Boolean(changed) || response.status === 401,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new CreatorFinanceError(0, Boolean(init.method));
  }
}
async function identity(signal: AbortSignal, expectedAccountId?: string) {
  const r = object(await request("/auth/me", signal, {}, expectedAccountId));
  const actor = { accountId: id(object(r.account).id), channelId: id(object(r.channel).id) };
  if (expectedAccountId && actor.accountId !== expectedAccountId)
    throw new CreatorFinanceError(403, false, true);
  return actor;
}
async function bounded<T>(
  signal: AbortSignal,
  ms: number,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, ms);
  try {
    return await operation(controller.signal);
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
function match(actor: { accountId: string; channelId: string }, snapshot: FinanceSnapshot) {
  if (actor.accountId !== snapshot.accountId || actor.channelId !== snapshot.overview.channel.id)
    throw new CreatorFinanceError(403, false, true);
}
export async function getCreatorFinance(
  signal: AbortSignal,
  expected?: FinanceSnapshot,
  expectedAccountId?: string,
): Promise<FinanceSnapshot> {
  return bounded(signal, 15000, async (signal) => {
    const actor = await identity(signal, expectedAccountId);
    if (expected) match(actor, expected);
    const [overview, analytics, disputes] = await Promise.all([
      request("/creator/studio/revenue", signal, {}, actor.accountId),
      request("/creator/studio/revenue/analytics", signal, {}, actor.accountId),
      request("/creator/studio/revenue/disputes", signal, {}, actor.accountId),
    ]);
    const result = {
      accountId: actor.accountId,
      overview: parseFinanceOverview(overview, actor.channelId),
      analytics: parseFinanceAnalytics(analytics, actor.channelId),
      disputes: unique(
        rows(object(disputes).items, (v) => parseFinanceDispute(v, actor.channelId)),
        (x) => x.id,
      ),
    };
    if (result.overview.currency !== result.analytics.currency) throw invalid();
    match(await identity(signal, actor.accountId), result);
    return result;
  });
}
export type ProfileInput = {
  legalName: string;
  preferredCurrency: string;
  provider: string;
  destination?: string;
  countryCode: string | null;
};
export function financeProfileInput(input: ProfileInput): ProfileInput {
  const provider = text(input.provider.trim(), 64, 2).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(provider)) throw invalid();
  const country =
    input.countryCode === null ? null : text(input.countryCode.trim().toUpperCase(), 2);
  if (country !== null && !/^[A-Z]{2}$/.test(country)) throw invalid();
  return {
    legalName: text(input.legalName.trim(), 160, 2),
    preferredCurrency: currency(input.preferredCurrency.trim().toUpperCase()),
    provider,
    countryCode: country,
    ...(input.destination !== undefined
      ? { destination: text(input.destination.trim(), 1500, 4) }
      : {}),
  };
}
export type FinanceWrite =
  | { kind: "profile"; input: ProfileInput }
  | { kind: "payout" }
  | {
      kind: "dispute";
      input: { category: RevenueDispute["category"]; message: string; payoutId: string | null };
    }
  | { kind: "start"; step: "IDENTITY" | "TAX" }
  | { kind: "refresh" };
export type FinanceAck =
  | { kind: "profile"; profile: CreatorPaymentProfile }
  | { kind: "payout"; id: string; status: string; amount: string; currency: string }
  | { kind: "dispute"; dispute: RevenueDispute }
  | { kind: "start"; step: "IDENTITY" | "TAX"; status: string; actionUrl: string | null }
  | { kind: "refresh"; compliance: CreatorComplianceView };
export async function saveCreatorFinance(
  snapshot: FinanceSnapshot,
  write: FinanceWrite,
  signal: AbortSignal,
): Promise<FinanceAck> {
  return bounded(signal, 30000, async (signal) => {
    match(await identity(signal, snapshot.accountId), snapshot);
    const channelId = snapshot.overview.channel.id;
    let path = "",
      method = "POST",
      body: unknown = {};
    if (write.kind === "profile") {
      path = "payment-profile";
      method = "PUT";
      body = financeProfileInput(write.input);
    } else if (write.kind === "payout") {
      if (!snapshot.overview.canRequestPayout) throw invalid();
      path = "payout-requests";
      body = { currency: snapshot.overview.currency };
    } else if (write.kind === "dispute") {
      path = "disputes";
      body = {
        category: choice(write.input.category, ["EARNINGS", "PAYOUT", "OTHER"]),
        message: text(write.input.message.trim(), 5000, 20),
        payoutId: nullable(write.input.payoutId, id),
      };
    } else if (write.kind === "start") {
      path = "compliance/start";
      body = { step: choice(write.step, ["IDENTITY", "TAX"]) };
    } else path = "compliance/refresh";
    const raw = await request(
      `/creator/studio/revenue/${path}`,
      signal,
      {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      snapshot.accountId,
    );
    // Decode the acknowledgment before a separate actor check; known writes are not failed reads.
    let ack: FinanceAck | undefined;
    try {
      ack = ((): FinanceAck => {
        if (write.kind === "profile") {
          const profile = parseFinanceProfile(raw, channelId),
            input = financeProfileInput(write.input);
          if (
            profile.legalName !== input.legalName ||
            profile.preferredCurrency !== input.preferredCurrency ||
            profile.provider !== input.provider ||
            profile.countryCode !== input.countryCode ||
            (input.destination !== undefined && !profile.hasDestination)
          )
            throw invalid();
          return { kind: "profile", profile };
        }
        if (write.kind === "dispute") {
          const dispute = parseFinanceDispute(raw, channelId);
          if (
            dispute.category !== write.input.category ||
            dispute.message !== write.input.message.trim() ||
            dispute.payoutId !== write.input.payoutId
          )
            throw invalid();
          return { kind: "dispute", dispute };
        }
        if (write.kind === "payout") {
          const r = object(raw),
            p = object(r.payout);
          if (
            id(p.channelId) !== channelId ||
            currency(p.currency) !== snapshot.overview.currency ||
            r.requestSource !== "CREATOR"
          )
            throw invalid();
          return {
            kind: "payout",
            id: id(p.id),
            status: choice(p.status, ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED"]),
            amount: financeAmount(p.amount),
            currency: currency(p.currency),
          };
        }
        if (write.kind === "refresh")
          return { kind: "refresh", compliance: parseFinanceCompliance(raw, channelId) };
        const r = object(raw),
          step = choice(r.step, ["IDENTITY", "TAX"]);
        if (write.kind !== "start" || step !== write.step) throw invalid();
        const actionUrl = nullable(r.actionUrl, (v) => {
          const url = new URL(text(v, 2048, 1));
          if (url.protocol !== "https:" || url.username || url.password) throw invalid();
          return url.href;
        });
        return { kind: "start", step, status: choice(r.status, statuses), actionUrl };
      })();
    } catch {
      /* A malformed response remains unacknowledged; never replay. */
    }
    try {
      match(await identity(signal, snapshot.accountId), snapshot);
    } catch (cause) {
      if (cause instanceof CreatorFinanceError)
        throw new CreatorFinanceError(cause.status, true, cause.scopeChanged, ack !== undefined);
      throw new CreatorFinanceError(0, true, false, ack !== undefined);
    }
    if (!ack) throw new CreatorFinanceError(0, true);
    return ack;
  });
}
export async function getFinanceStatement(snapshot: FinanceSnapshot, signal: AbortSignal) {
  return bounded(signal, 15000, async (signal) => {
    match(await identity(signal, snapshot.accountId), snapshot);
    const r = object(
        await request("/creator/studio/revenue/statement", signal, {}, snapshot.accountId),
      ),
      c = channel(r.channel);
    if (c.id !== snapshot.overview.channel.id || r.format !== "CSV") throw invalid();
    const filename = text(r.filename, 160, 1);
    if (!/^[A-Za-z0-9_.-]+\.csv$/.test(filename)) throw invalid();
    const result = {
      filename,
      generatedAt: date(r.generatedAt),
      content: text(r.content, 10000000),
      channel: c,
    };
    match(await identity(signal, snapshot.accountId), snapshot);
    return result;
  });
}
