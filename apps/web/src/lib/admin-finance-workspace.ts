import { apiBaseUrl } from "./api";
import { readAdminApiError } from "./admin-reauthentication";
import type { AdminRole, AdminSession } from "./admin-control";
import { financeAmount, parseFinanceCompliance, parseFinanceDispute } from "./creator-finance";

export interface RevenueReportRowInput {
  externalRowId: string;
  grossAmount: string;
  channelId?: string;
  channelHandle?: string;
  videoId?: string;
  videoSlug?: string;
  contentId?: string;
  adSource?: string;
  memo?: string;
}

export type RevenueReconciliationImportInput = {
  source: string;
  sourceReportId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  state: "ESTIMATED" | "FINAL";
} & ({ format: "CSV"; csv: string } | { format: "STRUCTURED"; rows: RevenueReportRowInput[] });

export class AdminFinanceError extends Error {
  constructor(
    readonly status: number,
    readonly writeStarted = false,
    readonly verificationRequired = false,
  ) {
    super("Financial administration could not be verified");
  }
}
const invalid = () => new AdminFinanceError(0);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid();
  return v as Record<string, unknown>;
}
function text(v: unknown, max: number, min = 0) {
  if (typeof v !== "string" || v.length > max || v.trim().length < min) throw invalid();
  return v;
}
function id(v: unknown) {
  const value = text(v, 36);
  if (!uuid.test(value)) throw invalid();
  return value;
}
function bool(v: unknown) {
  if (typeof v !== "boolean") throw invalid();
  return v;
}
function count(v: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max) throw invalid();
  return v;
}
function known<const T extends readonly string[]>(v: unknown, values: T): T[number] {
  if (typeof v !== "string" || !values.includes(v)) throw invalid();
  return v as T[number];
}
function nullable<T>(v: unknown, parse: (v: unknown) => T): T | null {
  return v === null ? null : parse(v);
}
function date(v: unknown) {
  const value = text(v, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw invalid();
  return value;
}
function currency(v: unknown) {
  const value = text(v, 3);
  if (!/^[A-Z]{3}$/.test(value)) throw invalid();
  return value;
}
function rows<T>(v: unknown, max: number, parse: (v: unknown) => T, key?: (v: T) => string) {
  if (!Array.isArray(v) || v.length > max) throw invalid();
  const values = v.map(parse);
  if (key && new Set(values.map(key)).size !== values.length) throw invalid();
  return values;
}
export const financePayoutStates = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "FAILED",
  "CANCELLED",
] as const;
export function financeManualPayoutChoices(status: (typeof financePayoutStates)[number]) {
  const transitions: Record<
    (typeof financePayoutStates)[number],
    readonly (typeof financePayoutStates)[number][]
  > = {
    PENDING: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["PAID", "FAILED", "CANCELLED"],
    PAID: [],
    FAILED: [],
    CANCELLED: [],
  };
  return [status, ...transitions[status]];
}
export const financeDisputeStates = ["OPEN", "REVIEWING", "RESOLVED", "REJECTED"] as const;
export const financeComplianceStates = [
  "NOT_STARTED",
  "PENDING",
  "VERIFIED",
  "REQUIRES_ACTION",
  "REJECTED",
] as const;
const financeRoles = [
  "SUPERADMIN",
  "ADMIN",
  "OPERATIONS",
  "CONTENT_MODERATOR",
  "AD_MANAGER",
  "FINANCE_MANAGER",
] as const;
function session(v: unknown): AdminSession {
  const r = object(v),
    roles = rows(
      r.roles,
      6,
      (v) => known(v, financeRoles),
      (v) => v,
    );
  if (!roles.length) throw invalid();
  return { accountId: id(r.accountId), roles };
}
export function canManageFinance(roles: readonly AdminRole[]) {
  return roles.some((role) => ["SUPERADMIN", "ADMIN", "FINANCE_MANAGER"].includes(role));
}
function match(first: AdminSession, last: AdminSession) {
  if (
    first.accountId !== last.accountId ||
    [...first.roles].sort().join(",") !== [...last.roles].sort().join(",") ||
    !canManageFinance(last.roles)
  )
    throw new AdminFinanceError(403);
}
export function parseFinanceSettings(v: unknown) {
  const r = object(v),
    threshold = text(r.payoutThresholdMicros, 128, 1);
  if (!/^\d+$/.test(threshold)) throw invalid();
  return {
    defaultCreatorRevenueShareBps: count(r.defaultCreatorRevenueShareBps, 10000),
    payoutThresholdMicros: threshold,
  };
}
function pagination(v: unknown, requested: number) {
  const p = object(v),
    page = count(p.page, 1000),
    take = count(p.take, 100),
    total = count(p.total),
    pages = count(p.pages);
  if (page !== requested || take !== 25 || pages !== Math.max(1, Math.ceil(total / take)))
    throw invalid();
  return { page, take, total, pages };
}
function channelCopy(v: unknown) {
  const r = object(v);
  return { name: text(r.name, 160, 1), handle: text(r.handle, 100, 1) };
}
export function parseFinanceLedger(v: unknown, requested: number) {
  const root = object(v);
  return {
    pagination: pagination(root.pagination, requested),
    items: rows(
      root.items,
      25,
      (v) => {
        const r = object(v);
        return {
          id: id(r.id),
          channelId: id(r.channelId),
          type: known(r.type, ["AD_REVENUE", "ADJUSTMENT", "REVERSAL", "PAYOUT"]),
          state: known(r.state, ["ESTIMATED", "FINAL", "ADJUSTMENT"]),
          amount: financeAmount(r.amount),
          grossAmount: nullable(r.grossAmount, financeAmount),
          currency: currency(r.currency),
          memo: nullable(r.memo, (v) => text(v, 5000)),
          adSource: nullable(r.adSource, (v) => text(v, 160)),
          periodStart: nullable(r.periodStart, date),
          periodEnd: nullable(r.periodEnd, date),
          occurredAt: date(r.occurredAt),
          channel: channelCopy(r.channel),
          video: nullable(r.video, (v) => {
            const a = object(v);
            return { title: text(a.title, 300, 1), slug: text(a.slug, 300, 1) };
          }),
          campaign: nullable(r.campaign, (v) => ({ name: text(object(v).name, 200, 1) })),
          payout: nullable(r.payout, (v) => {
            const a = object(v);
            return { id: id(a.id), status: known(a.status, financePayoutStates) };
          }),
        };
      },
      (v) => v.id,
    ),
  };
}
export function parseFinancePayout(v: unknown) {
  const r = object(v);
  return {
    id: id(r.id),
    channelId: id(r.channelId),
    status: known(r.status, financePayoutStates),
    amount: financeAmount(r.amount),
    currency: currency(r.currency),
    provider: text(r.provider, 64, 1),
    requestedAt: date(r.requestedAt),
    processedAt: nullable(r.processedAt, date),
    paidAt: nullable(r.paidAt, date),
    externalReference: nullable(r.externalReference, (v) => text(v, 255)),
    failureReason: nullable(r.failureReason, (v) => text(v, 1000)),
  };
}
export function parseFinancePayouts(v: unknown, requested: number) {
  const root = object(v);
  return {
    pagination: pagination(root.pagination, requested),
    items: rows(
      root.items,
      25,
      (v) => {
        const r = object(v);
        return {
          ...parseFinancePayout(r),
          channel: channelCopy(r.channel),
          providerTransfer: nullable(r.providerTransfer, (v) => {
            const t = object(v);
            return {
              state: known(t.state, [
                "READY",
                "SUBMITTING",
                "SUBMISSION_UNKNOWN",
                "SUBMITTED",
                "PROCESSING",
                "CANCEL_REQUESTED",
                "COMPLETED",
                "FAILED",
                "CANCELLED",
                "UNKNOWN",
              ]),
              externalTransferId: nullable(t.externalTransferId, (v) => text(v, 255)),
              providerResponseState: nullable(t.providerResponseState, (v) => text(v, 255)),
              submitAttempts: count(t.submitAttempts),
              statusAttempts: count(t.statusAttempts),
              cancelAttempts: count(t.cancelAttempts),
              nextRetryAt: nullable(t.nextRetryAt, date),
            };
          }),
        };
      },
      (v) => v.id,
    ),
  };
}
export function parseFinanceSummary(v: unknown) {
  const r = object(v),
    p = object(r.externalProvider);
  return {
    pendingPayouts: count(r.pendingPayouts),
    processingPayouts: count(r.processingPayouts),
    openDisputes: count(r.openDisputes),
    pendingValue: rows(
      r.pendingValue,
      1000,
      (v) => {
        const a = object(v);
        return { currency: currency(a.currency), amount: financeAmount(a.amount) };
      },
      (v) => v.currency,
    ),
    mode: known(r.mode, ["MANUAL_PAYOUT", "PROVIDER_AND_MANUAL_PAYOUT"]),
    externalProvidersConnected: bool(r.externalProvidersConnected),
    externalProvider: {
      provider: text(p.provider, 64, 1),
      connected: bool(p.connected),
      productionEnabled: bool(p.productionEnabled),
    },
  };
}
export function parseFinanceDisputes(v: unknown) {
  return rows(
    v,
    250,
    (v) => {
      const r = object(v),
        channelId = id(r.channelId);
      return {
        ...parseFinanceDispute(r, channelId),
        channelName: text(r.channelName, 160, 1),
        channelHandle: text(r.channelHandle, 100, 1),
        creatorEmail: text(r.creatorEmail, 320, 1),
        payoutAmount: nullable(r.payoutAmount, financeAmount),
        payoutCurrency: nullable(r.payoutCurrency, currency),
        payoutStatus: nullable(r.payoutStatus, (v) => known(v, financePayoutStates)),
      };
    },
    (v) => v.id,
  );
}
export function parseFinanceContract(v: unknown, channelId: string) {
  const r = object(v);
  if (id(r.channelId) !== channelId) throw invalid();
  return {
    id: id(r.id),
    channelId,
    status: known(r.status, ["PENDING", "ACTIVE", "SUSPENDED", "ENDED"]),
    revenueShareBps: nullable(r.revenueShareBps, (v) => count(v, 10000)),
    effectiveFrom: nullable(r.effectiveFrom, date),
    effectiveTo: nullable(r.effectiveTo, date),
    termsVersion: nullable(r.termsVersion, (v) => text(v, 80)),
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
  };
}
export function parseFinanceChannelTarget(v: unknown) {
  const r = object(v);
  return {
    id: id(r.id),
    ...channelCopy(r),
    status: known(r.status, ["ACTIVE", "HIDDEN", "SUSPENDED", "REMOVED"]),
    payoutProfile: nullable(r.payoutProfile, (v) => {
      const p = object(v);
      return {
        preferredCurrency: currency(p.preferredCurrency),
        identityStatus: known(p.identityStatus, financeComplianceStates),
        taxStatus: known(p.taxStatus, financeComplianceStates),
        payoutDestinationStatus: known(p.payoutDestinationStatus, financeComplianceStates),
      };
    }),
  };
}
export type FinanceChannelTarget = ReturnType<typeof parseFinanceChannelTarget>;
export type FinancePayout = ReturnType<typeof parseFinancePayouts>["items"][number];
export type FinanceDispute = ReturnType<typeof parseFinanceDisputes>[number];
export type FinanceFilters = {
  ledgerPage: number;
  ledgerChannelId: string;
  payoutPage: number;
  payoutStatus: string;
  disputeStatus: string;
};
async function request(path: string, signal: AbortSignal, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    signal,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const rejected =
      response.status === 403
        ? await response
            .clone()
            .json()
            .catch(() => null)
        : null;
    await readAdminApiError(response);
    throw new AdminFinanceError(
      response.status,
      Boolean(init.method),
      rejected?.error?.code === "STEP_UP_REQUIRED",
    );
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
async function preflight(signal: AbortSignal, expected?: AdminSession) {
  const first = session(await request("/admin/session", signal));
  if (!canManageFinance(first.roles)) throw new AdminFinanceError(403);
  if (expected) match(expected, first);
  return first;
}
export async function getAdminFinanceSnapshot(
  filters: FinanceFilters,
  signal: AbortSignal,
  expected?: AdminSession,
) {
  return bounded(signal, 15000, async (signal) => {
    const first = await preflight(signal, expected);
    const ledgerPage = count(filters.ledgerPage, 1000),
      payoutPage = count(filters.payoutPage, 1000);
    if (ledgerPage < 1 || payoutPage < 1) throw invalid();
    const ledger = new URLSearchParams({ page: String(ledgerPage), take: "25" }),
      payouts = new URLSearchParams({ page: String(payoutPage), take: "25" });
    if (filters.ledgerChannelId) ledger.set("channelId", id(filters.ledgerChannelId));
    if (filters.payoutStatus)
      payouts.set("status", known(filters.payoutStatus, financePayoutStates));
    const dispute = filters.disputeStatus
      ? `?status=${known(filters.disputeStatus, financeDisputeStates)}`
      : "";
    const [settings, ledgerData, payoutData, summary, disputes] = await Promise.all([
      request("/admin/revenue/settings", signal),
      request(`/admin/revenue/ledger?${ledger}`, signal),
      request(`/admin/revenue/payouts?${payouts}`, signal),
      request("/admin/revenue/finance-summary", signal),
      request(`/admin/revenue/disputes${dispute}`, signal),
    ]);
    const result = {
      session: first,
      settings: parseFinanceSettings(settings),
      ledger: parseFinanceLedger(ledgerData, ledgerPage),
      payouts: parseFinancePayouts(payoutData, payoutPage),
      summary: parseFinanceSummary(summary),
      disputes: parseFinanceDisputes(disputes),
    };
    if (
      filters.ledgerChannelId &&
      result.ledger.items.some((row) => row.channelId !== filters.ledgerChannelId)
    )
      throw invalid();
    if (
      filters.payoutStatus &&
      result.payouts.items.some((row) => row.status !== filters.payoutStatus)
    )
      throw invalid();
    if (
      filters.disputeStatus &&
      result.disputes.some((row) => row.status !== filters.disputeStatus)
    )
      throw invalid();
    match(first, session(await request("/admin/session", signal)));
    return result;
  });
}
export type AdminFinanceSnapshot = Awaited<ReturnType<typeof getAdminFinanceSnapshot>>;
export async function searchFinanceTargets(
  query: string,
  expected: AdminSession,
  signal: AbortSignal,
) {
  return bounded(signal, 15000, async (signal) => {
    const first = await preflight(signal, expected),
      value = text(query.trim(), 200, 2);
    const result = rows(
      object(
        await request(
          `/admin/operations/directory/revenue-channels?query=${encodeURIComponent(value)}`,
          signal,
        ),
      ).items,
      25,
      parseFinanceChannelTarget,
      (v) => v.id,
    );
    match(first, session(await request("/admin/session", signal)));
    return result;
  });
}
export async function getFinanceTarget(
  channelId: string,
  expected: AdminSession,
  signal: AbortSignal,
) {
  return bounded(signal, 15000, async (signal) => {
    const first = await preflight(signal, expected),
      targetId = id(channelId);
    const [contracts, compliance] = await Promise.all([
      request(`/admin/revenue/channels/${targetId}/contracts`, signal),
      request(`/admin/revenue/channels/${targetId}/compliance`, signal),
    ]);
    const root = object(contracts),
      result = {
        channelId: targetId,
        defaultRevenueShareBps: count(root.defaultRevenueShareBps, 10000),
        contracts: rows(
          root.contracts,
          10000,
          (v) => parseFinanceContract(v, targetId),
          (v) => v.id,
        ),
        compliance: parseFinanceCompliance(compliance, targetId),
      };
    match(first, session(await request("/admin/session", signal)));
    return result;
  });
}
export type FinanceTargetSnapshot = Awaited<ReturnType<typeof getFinanceTarget>>;

const recoveryActions = [
  "REVENUE_SETTINGS_UPDATED",
  "CREATOR_CONTRACT_CREATED",
  "REVENUE_IMPORTED",
  "REVENUE_ADJUSTMENT_CREATED",
  "PAYOUT_CREATED",
  "PAYOUT_STATUS_UPDATED",
  "revenue.dispute_updated",
  "creator.compliance_status_overridden",
  "REVENUE_REPORT_RECONCILED",
] as const;
export function parseFinanceActions(v: unknown, actorId: string) {
  const root = object(v);
  if (id(root.actorAccountId) !== actorId || root.limit !== 100) throw invalid();
  return rows(
    root.items,
    100,
    (v) => {
      const r = object(v),
        metadata = object(r.metadata),
        safe: Record<string, string | number | boolean | null> = {};
      if (Object.keys(metadata).length > 32) throw invalid();
      for (const [key, value] of Object.entries(metadata)) {
        if (
          ![
            "channelId",
            "payoutId",
            "paymentProfileId",
            "videoId",
            "campaignId",
            "amount",
            "payoutThresholdMicros",
            "defaultCreatorRevenueShareBps",
            "revenueShareBps",
            "created",
            "duplicates",
            "requested",
            "entryCount",
            "totalRows",
            "matchedRows",
            "unmatchedRows",
            "duplicateRows",
            "correctedRows",
            "finalizedRows",
            "anomalousRows",
            "currency",
            "source",
            "sourceReportId",
            "provider",
            "requestSource",
            "status",
            "from",
            "to",
            "field",
            "effectiveFrom",
            "effectiveTo",
            "beneficiarySnapshotted",
            "rawIdentityDataAccessed",
            "taxIdentifierAccessed",
            "bankDataAccessed",
            "automaticProviderSyncConfigured",
          ].includes(key)
        )
          throw invalid();
        if (value === null || typeof value === "boolean") safe[key] = value;
        else if (typeof value === "string") safe[key] = text(value, 160);
        else if (typeof value === "number") safe[key] = count(value);
        else throw invalid();
      }
      return {
        id: id(r.id),
        action: known(r.action, recoveryActions),
        entityType: text(r.entityType, 120, 1),
        entityId: nullable(r.entityId, (v) => text(v, 120)),
        reason: nullable(r.reason, (v) => text(v, 5000)),
        createdAt: date(r.createdAt),
        metadata: safe,
      };
    },
    (r) => r.id,
  );
}
export async function getFinanceActions(expected: AdminSession, signal: AbortSignal) {
  return bounded(signal, 15000, async (signal) => {
    const first = await preflight(signal, expected);
    const result = parseFinanceActions(
      await request("/admin/revenue/actions", signal),
      first.accountId,
    );
    match(first, session(await request("/admin/session", signal)));
    return result;
  });
}
export async function getFinancePayoutRecord(
  payoutId: string,
  expected: AdminSession,
  signal: AbortSignal,
) {
  return bounded(signal, 15000, async (signal) => {
    const first = await preflight(signal, expected),
      targetId = id(payoutId);
    const r = object(await request(`/admin/revenue/payouts/${targetId}`, signal)),
      channel = object(r.channel);
    if (id(r.payoutId) !== targetId) throw invalid();
    const result = {
      ...parseFinancePayout({ ...r, id: r.payoutId, channelId: channel.id }),
      channel: channelCopy(channel),
    };
    match(first, session(await request("/admin/session", signal)));
    return result;
  });
}
export async function reviewFinanceCommand(
  command: FinanceCommand,
  expected: AdminSession,
  signal: AbortSignal,
) {
  if (command.kind === "reportImport")
    return {
      kind: "report" as const,
      report: await lookupFinanceReport(
        command.input.source,
        command.input.sourceReportId,
        expected,
        signal,
      ),
    };
  const channelId =
    command.kind === "adjustment"
      ? command.input.channelId
      : command.kind === "import"
        ? command.input.entries[0].channelId
        : "channelId" in command
          ? command.channelId
          : null;
  if (command.kind === "payoutStatus")
    return {
      kind: "payoutStatus" as const,
      payout: await getFinancePayoutRecord(command.base.id, expected, signal),
    };
  if (channelId)
    return {
      kind: "channel" as const,
      target: await getFinanceTarget(channelId, expected, signal),
    };
  // Dispute history is bounded; absence is explicitly inconclusive, even after this read.
  return {
    kind: "snapshot" as const,
    snapshot: await getAdminFinanceSnapshot(
      { ledgerPage: 1, ledgerChannelId: "", payoutPage: 1, payoutStatus: "", disputeStatus: "" },
      signal,
      expected,
    ),
  };
}
export function financeBps(value: string) {
  if (!/^\d{1,5}$/.test(value.trim())) throw invalid();
  return count(Number(value.trim()), 10000);
}
export function financeInputAmount(value: string, signed = false) {
  const result = value.trim();
  if (!(signed ? /^-?\d{1,14}(?:\.\d{1,6})?$/ : /^\d{1,14}(?:\.\d{1,6})?$/).test(result))
    throw invalid();
  return result;
}
export function financeMicros(value: string) {
  const normalized = financeAmount(value),
    negative = normalized.startsWith("-"),
    [whole = "0", fraction = ""] = normalized.replace(/^-/, "").split(".");
  const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  return negative ? -result : result;
}
type FinanceImportEntry = {
  idempotencyKey: string;
  channelId: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: string;
  currency: string;
  state: "ESTIMATED" | "FINAL";
  adSource?: string | null;
  memo?: string | null;
};
export type FinanceCommand =
  | { kind: "reportImport"; input: RevenueReconciliationImportInput }
  | {
      kind: "settings";
      input: { defaultCreatorRevenueShareBps: number; payoutThresholdMicros: string };
    }
  | {
      kind: "contract";
      channelId: string;
      input: {
        revenueShareBps: number;
        effectiveFrom: string;
        effectiveTo: string | null;
        termsVersion: string | null;
        status: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
      };
    }
  | {
      kind: "adjustment";
      input: { channelId: string; amount: string; currency: string; reason: string };
    }
  | { kind: "import"; input: { source: string; entries: [FinanceImportEntry] } }
  | { kind: "payout"; channelId: string; currency: string }
  | {
      kind: "payoutStatus";
      base: FinancePayout;
      input: {
        status: FinancePayout["status"];
        reason: string;
        externalReference: string | null;
        failureReason: string | null;
      };
    }
  | {
      kind: "dispute";
      base: FinanceDispute;
      input: { status: FinanceDispute["status"]; reason: string; resolution: string | null };
    }
  | {
      kind: "compliance";
      channelId: string;
      input: {
        field: "IDENTITY" | "TAX" | "PAYOUT_DESTINATION";
        status: (typeof financeComplianceStates)[number];
        reason: string;
      };
    };
function reason(value: unknown) {
  return text(value, 500, 8).trim();
}
function prepareCommand(command: FinanceCommand) {
  switch (command.kind) {
    case "reportImport":
      return {
        path: "/admin/revenue/reconciliation/imports",
        method: "POST",
        body: financeReportInput(command.input),
      };
    case "settings":
      return {
        path: "/admin/revenue/settings",
        method: "PATCH",
        body: parseFinanceSettings(command.input),
      };
    case "contract": {
      const a = command.input,
        body = {
          revenueShareBps: count(a.revenueShareBps, 10000),
          effectiveFrom: date(a.effectiveFrom),
          effectiveTo: nullable(a.effectiveTo, date),
          termsVersion: nullable(a.termsVersion, (v) => text(v, 80, 1).trim()),
          status: known(a.status, ["PENDING", "ACTIVE", "SUSPENDED", "ENDED"]),
        };
      if (body.effectiveTo && Date.parse(body.effectiveTo) <= Date.parse(body.effectiveFrom))
        throw invalid();
      return {
        path: `/admin/revenue/channels/${id(command.channelId)}/contracts`,
        method: "POST",
        body,
      };
    }
    case "adjustment": {
      const a = command.input,
        amount = financeInputAmount(a.amount, true);
      if (financeMicros(amount) === 0n) throw invalid();
      return {
        path: "/admin/revenue/adjustments",
        method: "POST",
        body: {
          channelId: id(a.channelId),
          amount,
          currency: currency(a.currency),
          reason: reason(a.reason),
        },
      };
    }
    case "import": {
      if (command.input.entries.length !== 1) throw invalid();
      const a = command.input.entries[0],
        entry = {
          idempotencyKey: text(a.idempotencyKey, 160, 8),
          channelId: id(a.channelId),
          periodStart: date(a.periodStart),
          periodEnd: date(a.periodEnd),
          grossAmount: financeInputAmount(a.grossAmount),
          currency: currency(a.currency),
          state: known(a.state, ["ESTIMATED", "FINAL"]),
          adSource: a.adSource == null ? null : text(a.adSource, 80, 1),
          memo: a.memo == null ? null : text(a.memo, 500),
        };
      if (Date.parse(entry.periodEnd) <= Date.parse(entry.periodStart)) throw invalid();
      return {
        path: "/admin/revenue/imports",
        method: "POST",
        body: { source: text(command.input.source, 80, 1), entries: [entry] },
      };
    }
    case "payout":
      return {
        path: "/admin/revenue/payouts",
        method: "POST",
        body: { channelId: id(command.channelId), currency: currency(command.currency) },
      };
    case "payoutStatus": {
      if (
        command.base.provider !== "MANUAL" ||
        !financeManualPayoutChoices(command.base.status).includes(command.input.status)
      )
        throw invalid();
      return {
        path: `/admin/revenue/payouts/${id(command.base.id)}`,
        method: "PATCH",
        body: {
          status: known(command.input.status, financePayoutStates),
          reason: reason(command.input.reason),
          externalReference: nullable(command.input.externalReference, (v) => text(v, 255).trim()),
          failureReason: nullable(command.input.failureReason, (v) => text(v, 1000).trim()),
        },
      };
    }
    case "dispute": {
      const status = known(command.input.status, financeDisputeStates),
        resolution = nullable(command.input.resolution, (v) => text(v, 5000, 8).trim());
      if (["RESOLVED", "REJECTED"].includes(status) && !resolution) throw invalid();
      return {
        path: `/admin/revenue/disputes/${id(command.base.id)}`,
        method: "PATCH",
        body: { status, resolution, reason: reason(command.input.reason) },
      };
    }
    case "compliance":
      return {
        path: `/admin/revenue/channels/${id(command.channelId)}/compliance`,
        method: "PATCH",
        body: {
          field: known(command.input.field, ["IDENTITY", "TAX", "PAYOUT_DESTINATION"]),
          status: known(command.input.status, financeComplianceStates),
          reason: reason(command.input.reason),
        },
      };
  }
}
function ack(command: FinanceCommand, value: unknown) {
  const r = object(value);
  switch (command.kind) {
    case "reportImport": {
      const record = { ...parseFinanceReport(r), idempotentReplay: bool(r.idempotentReplay) },
        input = command.input;
      if (
        record.source !== input.source.trim() ||
        record.sourceReportId !== input.sourceReportId.trim() ||
        record.currency !== input.currency ||
        record.state !== input.state ||
        record.importFormat !== input.format ||
        Date.parse(record.periodStart) !== Date.parse(input.periodStart) ||
        Date.parse(record.periodEnd) !== Date.parse(input.periodEnd) ||
        (input.format === "STRUCTURED" && record.totalRows !== input.rows.length)
      )
        throw invalid();
      return { kind: "reportImport" as const, record };
    }
    case "settings": {
      const record = parseFinanceSettings(r);
      if (
        record.defaultCreatorRevenueShareBps !== command.input.defaultCreatorRevenueShareBps ||
        record.payoutThresholdMicros !== command.input.payoutThresholdMicros
      )
        throw invalid();
      return { kind: "settings" as const, record };
    }
    case "contract": {
      const record = parseFinanceContract(r, command.channelId),
        input = command.input;
      if (
        record.revenueShareBps !== input.revenueShareBps ||
        record.status !== input.status ||
        Date.parse(record.effectiveFrom ?? "") !== Date.parse(input.effectiveFrom) ||
        (record.effectiveTo === null
          ? input.effectiveTo !== null
          : Date.parse(record.effectiveTo) !== Date.parse(input.effectiveTo ?? "")) ||
        record.termsVersion !== input.termsVersion
      )
        throw invalid();
      return { kind: "contract" as const, record };
    }
    case "adjustment": {
      const record = {
        id: id(r.id),
        channelId: id(r.channelId),
        amount: financeAmount(r.amount),
        currency: currency(r.currency),
        memo: text(r.memo, 500),
        type: known(r.type, ["ADJUSTMENT"]),
        state: known(r.state, ["ADJUSTMENT"]),
      };
      if (
        record.channelId !== command.input.channelId ||
        financeMicros(record.amount) !== financeMicros(command.input.amount) ||
        record.currency !== command.input.currency ||
        record.memo !== command.input.reason.trim()
      )
        throw invalid();
      return { kind: "adjustment" as const, record };
    }
    case "import": {
      const record = {
        created: count(r.created, 1),
        duplicates: count(r.duplicates, 1),
        requested: count(r.requested, 1),
      };
      if (record.requested !== 1 || record.created + record.duplicates !== 1) throw invalid();
      return { kind: "import" as const, record };
    }
    case "payout": {
      const record = parseFinancePayout(r);
      if (
        record.channelId !== command.channelId ||
        record.currency !== command.currency ||
        record.status !== "PENDING" ||
        r.requestSource !== "ADMIN"
      )
        throw invalid();
      return { kind: "payout" as const, record };
    }
    case "payoutStatus": {
      const record = parseFinancePayout(r),
        base = command.base;
      if (
        record.id !== base.id ||
        record.channelId !== base.channelId ||
        record.status !== command.input.status ||
        record.provider !== base.provider ||
        financeMicros(record.amount) !== financeMicros(base.amount) ||
        record.currency !== base.currency ||
        record.externalReference !== command.input.externalReference ||
        record.failureReason !== command.input.failureReason
      )
        throw invalid();
      return { kind: "payoutStatus" as const, record };
    }
    case "dispute": {
      const record = parseFinanceDispute(r, command.base.channelId);
      if (
        record.id !== command.base.id ||
        record.status !== command.input.status ||
        record.resolution !== command.input.resolution
      )
        throw invalid();
      return { kind: "dispute" as const, record };
    }
    case "compliance": {
      const record = {
        profileId: id(r.profileId),
        field: known(r.field, ["IDENTITY", "TAX", "PAYOUT_DESTINATION"]),
        status: known(r.status, financeComplianceStates),
        compliance: parseFinanceCompliance(r.compliance, command.channelId),
      };
      if (record.field !== command.input.field || record.status !== command.input.status)
        throw invalid();
      return { kind: "compliance" as const, record };
    }
  }
}
export async function saveAdminFinance(
  command: FinanceCommand,
  expected: AdminSession,
  signal: AbortSignal,
) {
  let started = false;
  try {
    return await bounded(signal, 30000, async (signal) => {
      const prepared = prepareCommand(command),
        first = await preflight(signal, expected);
      started = true;
      const result = ack(
        command,
        await request(prepared.path, signal, {
          method: prepared.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(prepared.body),
        }),
      );
      match(first, session(await request("/admin/session", signal)));
      return result;
    });
  } catch (error) {
    throw new AdminFinanceError(
      error instanceof AdminFinanceError ? error.status : 0,
      started,
      error instanceof AdminFinanceError && error.verificationRequired,
    );
  }
}
export type FinanceAcknowledgment = Awaited<ReturnType<typeof saveAdminFinance>>;

export const financeReconciliationStates = [
  "MATCHED",
  "UNMATCHED",
  "DUPLICATE",
  "CORRECTED",
  "FINALIZED",
  "ANOMALOUS",
] as const;
export function parseFinanceReport(v: unknown) {
  const r = object(v),
    counts = {
      totalRows: count(r.totalRows, 5000),
      matchedRows: count(r.matchedRows, 5000),
      unmatchedRows: count(r.unmatchedRows, 5000),
      duplicateRows: count(r.duplicateRows, 5000),
      correctedRows: count(r.correctedRows, 5000),
      finalizedRows: count(r.finalizedRows, 5000),
      anomalousRows: count(r.anomalousRows, 5000),
    };
  if (
    !counts.totalRows ||
    counts.totalRows !==
      counts.matchedRows +
        counts.unmatchedRows +
        counts.duplicateRows +
        counts.correctedRows +
        counts.finalizedRows +
        counts.anomalousRows
  )
    throw invalid();
  return {
    id: id(r.id),
    source: text(r.source, 80, 1),
    sourceReportId: text(r.sourceReportId, 160, 1),
    periodStart: date(r.periodStart),
    periodEnd: date(r.periodEnd),
    currency: currency(r.currency),
    state: known(r.state, ["ESTIMATED", "FINAL"]),
    importFormat: known(r.importFormat, ["CSV", "STRUCTURED"]),
    ...counts,
    createdAt: date(r.createdAt),
  };
}
export function financeReportInput(
  input: RevenueReconciliationImportInput,
): RevenueReconciliationImportInput {
  const base = {
    source: text(input.source.trim(), 80, 1),
    sourceReportId: text(input.sourceReportId.trim(), 160, 1),
    periodStart: date(input.periodStart),
    periodEnd: date(input.periodEnd),
    currency: currency(input.currency),
    state: known(input.state, ["ESTIMATED", "FINAL"]),
  };
  if (Date.parse(base.periodEnd) <= Date.parse(base.periodStart)) throw invalid();
  if (input.format === "CSV") return { ...base, format: "CSV", csv: text(input.csv, 5000000, 1) };
  if (input.format !== "STRUCTURED" || !Array.isArray(input.rows) || !input.rows.length)
    throw invalid();
  return {
    ...base,
    format: "STRUCTURED",
    rows: rows(input.rows, 5000, (v) => {
      const r = object(v),
        optional: {
          channelId?: string;
          channelHandle?: string;
          videoId?: string;
          videoSlug?: string;
          contentId?: string;
          adSource?: string;
          memo?: string;
        } = {};
      if (
        Object.keys(r).some(
          (key) =>
            ![
              "externalRowId",
              "grossAmount",
              "channelId",
              "channelHandle",
              "videoId",
              "videoSlug",
              "contentId",
              "adSource",
              "memo",
            ].includes(key),
        )
      )
        throw invalid();
      if (r.channelId !== undefined) optional.channelId = id(r.channelId);
      if (r.videoId !== undefined) optional.videoId = id(r.videoId);
      if (r.channelHandle !== undefined) optional.channelHandle = text(r.channelHandle, 80, 1);
      if (r.videoSlug !== undefined) optional.videoSlug = text(r.videoSlug, 160, 1);
      if (r.contentId !== undefined) optional.contentId = text(r.contentId, 200, 1);
      if (r.adSource !== undefined) optional.adSource = text(r.adSource, 80, 1);
      if (r.memo !== undefined) optional.memo = text(r.memo, 500);
      return {
        externalRowId: text(r.externalRowId, 160, 1),
        grossAmount: financeInputAmount(text(r.grossAmount, 22)),
        ...optional,
      };
    }),
  };
}
export async function getFinanceReconciliation(
  filters: { source: string; status: string; page: number },
  expected: AdminSession,
  signal: AbortSignal,
) {
  return bounded(signal, 15000, async (signal) => {
    const first = await preflight(signal, expected),
      query = new URLSearchParams({ page: String(count(filters.page, 1000)), take: "25" });
    if (filters.page < 1) throw invalid();
    if (filters.source) query.set("source", text(filters.source.trim(), 80, 1));
    if (filters.status) query.set("status", known(filters.status, financeReconciliationStates));
    const [rawCapabilities, rawReports] = await Promise.all([
      request("/admin/revenue/reconciliation/capabilities", signal),
      request(`/admin/revenue/reconciliation/reports?${query}`, signal),
    ]);
    const c = object(rawCapabilities),
      columns = object(c.csvColumns),
      r = object(rawReports);
    if (c.providerNeutral !== true) throw invalid();
    const result = {
      capabilities: {
        adapter: text(c.adapter, 80, 1),
        automaticProviderSyncConfigured: bool(c.automaticProviderSyncConfigured),
        maxRows: count(c.maxRows, 5000),
        supportedImportFormats: rows(
          c.supportedImportFormats,
          2,
          (v) => known(v, ["CSV", "STRUCTURED"]),
          (v) => v,
        ),
        requiredEnvelopeFields: rows(c.requiredEnvelopeFields, 20, (v) => text(v, 80, 1)),
        csvColumns: {
          required: rows(columns.required, 20, (v) => text(v, 80, 1)),
          optional: rows(columns.optional, 20, (v) => text(v, 80, 1)),
        },
      },
      reports: {
        items: rows(r.items, 25, parseFinanceReport, (v) => v.id),
        pagination: pagination(r.pagination, filters.page),
      },
    };
    if (filters.source && result.reports.items.some((row) => row.source !== filters.source.trim()))
      throw invalid();
    match(first, session(await request("/admin/session", signal)));
    return result;
  });
}
export async function getFinanceReportDetail(
  reportId: string,
  expected: AdminSession,
  signal: AbortSignal,
) {
  return bounded(signal, 15000, async (signal) => {
    const first = await preflight(signal, expected),
      target = id(reportId),
      r = object(await request(`/admin/revenue/reconciliation/reports/${target}`, signal)),
      report = parseFinanceReport(r);
    if (report.id !== target) throw invalid();
    const result = {
      report,
      rows: rows(
        r.rows,
        5000,
        (v) => {
          const r = object(v);
          return {
            id: id(r.id),
            rowNumber: count(r.rowNumber, 5000),
            externalRowId: text(r.externalRowId, 160, 1),
            channelRef: nullable(r.channelRef, (v) => text(v, 200)),
            videoRef: nullable(r.videoRef, (v) => text(v, 200)),
            contentRef: nullable(r.contentRef, (v) => text(v, 200)),
            channelId: nullable(r.channelId, id),
            videoId: nullable(r.videoId, id),
            grossAmount: financeAmount(r.grossAmount),
            creatorAmount: nullable(r.creatorAmount, financeAmount),
            currency: currency(r.currency),
            state: known(r.state, ["ESTIMATED", "FINAL"]),
            reconciliationStatus: known(r.reconciliationStatus, financeReconciliationStates),
            ledgerEntryId: nullable(r.ledgerEntryId, id),
            priorRowId: nullable(r.priorRowId, id),
            reason: nullable(r.reason, (v) => text(v, 5000)),
            memo: nullable(r.memo, (v) => text(v, 5000)),
            createdAt: date(r.createdAt),
          };
        },
        (v) => v.id,
      ),
    };
    if (
      result.rows.length !== report.totalRows ||
      result.rows.some((row) => row.currency !== report.currency || row.state !== report.state)
    )
      throw invalid();
    match(first, session(await request("/admin/session", signal)));
    return result;
  });
}
async function lookupFinanceReport(
  source: string,
  sourceReportId: string,
  expected: AdminSession,
  signal: AbortSignal,
) {
  return bounded(signal, 15000, async (signal) => {
    const first = await preflight(signal, expected),
      query = new URLSearchParams({
        source: text(source.trim(), 80, 1),
        sourceReportId: text(sourceReportId.trim(), 160, 1),
      });
    let report: ReturnType<typeof parseFinanceReport> | null;
    try {
      report = parseFinanceReport(
        await request(`/admin/revenue/reconciliation/lookup?${query}`, signal),
      );
    } catch (error) {
      if (error instanceof AdminFinanceError && error.status === 404) report = null;
      else throw error;
    }
    if (
      report &&
      (report.source !== source.trim() || report.sourceReportId !== sourceReportId.trim())
    )
      throw invalid();
    match(first, session(await request("/admin/session", signal)));
    return report;
  });
}
