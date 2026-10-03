import { apiBaseUrl } from "./api";
import { getAdminSession, type AdminRole, type AdminSession } from "./admin-control";
import { adminVerificationRequired, readAdminApiError } from "./admin-reauthentication";
import { canManageFinance, financePayoutStates } from "./admin-finance-workspace";
import { financeAmount } from "./creator-finance";
import type { PayoutProviderCapabilities, PayoutProviderTransferView } from "./payout-provider";

export class PayoutWorkspaceError extends Error {
  constructor(
    readonly status: number,
    readonly writeStarted = false,
    readonly verificationRequired = false,
  ) {
    super("Payout operation could not be verified");
  }
}
const invalid = () => new PayoutWorkspaceError(0);
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid();
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 500, min = 0) {
  if (typeof v !== "string" || v.length > max || v.trim().length < min) throw invalid();
  return v;
}
function id(v: unknown) {
  const s = text(v, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))
    throw invalid();
  return s;
}
function bool(v: unknown) {
  if (typeof v !== "boolean") throw invalid();
  return v;
}
function count(v: unknown) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw invalid();
  return v;
}
function nullable(v: unknown, max = 500) {
  return v === null ? null : text(v, max);
}
function date(v: unknown) {
  const s = text(v, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s) || !Number.isFinite(Date.parse(s))) throw invalid();
  return s;
}
function nullableDate(v: unknown) {
  return v === null ? null : date(v);
}
function known<const T extends readonly string[]>(v: unknown, values: T): T[number] {
  if (typeof v !== "string" || !values.includes(v)) throw invalid();
  return v as T[number];
}
function currency(v: unknown) {
  const s = text(v, 3);
  if (!/^[A-Z]{3}$/.test(s)) throw invalid();
  return s;
}
export function payoutAmountMicros(v: unknown) {
  const amount = financeAmount(v),
    negative = amount.startsWith("-");
  const [whole = "0", fraction = ""] = amount.replace(/^-/, "").split(".");
  const value = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  return negative ? -value : value;
}
const roles = [
  "SUPERADMIN",
  "ADMIN",
  "OPERATIONS",
  "CONTENT_MODERATOR",
  "AD_MANAGER",
  "FINANCE_MANAGER",
] as const;
const transferStates = [
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
] as const;
export function parsePayoutSession(v: unknown): AdminSession {
  const row = object(v);
  if (!Array.isArray(row.roles) || row.roles.length < 1 || row.roles.length > 6) throw invalid();
  const actualRoles = row.roles.map((v) => known(v, roles));
  if (new Set(actualRoles).size !== actualRoles.length) throw invalid();
  return { accountId: id(row.accountId), roles: actualRoles as AdminRole[] };
}
function match(a: AdminSession, b: AdminSession) {
  if (
    a.accountId !== b.accountId ||
    [...a.roles].sort().join(",") !== [...b.roles].sort().join(",") ||
    !canManageFinance(b.roles)
  )
    throw new PayoutWorkspaceError(403);
}
export function parsePayoutDetail(v: unknown, payoutId: string) {
  const row = object(v),
    channel = object(row.channel);
  if (id(row.payoutId) !== id(payoutId)) throw invalid();
  const profile = row.paymentProfile === null ? null : object(row.paymentProfile);
  return {
    payoutId,
    channel: {
      id: id(channel.id),
      name: text(channel.name, 200, 1),
      handle: text(channel.handle, 80, 1),
    },
    status: known(row.status, financePayoutStates),
    provider: text(row.provider, 64, 1),
    amount: financeAmount(row.amount),
    currency: currency(row.currency),
    requestedAt: date(row.requestedAt),
    processedAt: nullableDate(row.processedAt),
    paidAt: nullableDate(row.paidAt),
    externalReference: nullable(row.externalReference),
    failureReason: nullable(row.failureReason, 2000),
    beneficiarySnapshotAvailable: bool(row.beneficiarySnapshotAvailable),
    destinationRevealAllowed: bool(row.destinationRevealAllowed),
    paymentProfile: profile
      ? {
          id: id(profile.id),
          legalName: nullable(profile.legalName, 255),
          provider: nullable(profile.provider, 64),
          destinationMask: nullable(profile.destinationMask, 255),
          countryCode: nullable(profile.countryCode, 2),
          hasDestination: bool(profile.hasDestination),
        }
      : null,
  };
}
export type PayoutDetail = ReturnType<typeof parsePayoutDetail>;
export function parsePayoutProvider(
  v: unknown,
  detail: Pick<PayoutDetail, "payoutId" | "provider" | "amount" | "currency">,
): PayoutProviderTransferView {
  const row = object(v),
    payout = object(row.payout),
    caps = object(row.capabilities),
    retry = object(caps.retryPolicy);
  const amount = financeAmount(payout.amount);
  if (
    id(payout.id) !== detail.payoutId ||
    text(payout.provider, 64) !== detail.provider ||
    payoutAmountMicros(amount) !== payoutAmountMicros(detail.amount) ||
    currency(payout.currency) !== detail.currency
  )
    throw invalid();
  if (caps.rawBankSecretsSentByThisAdapter !== false) throw invalid();
  const capabilities: PayoutProviderCapabilities = {
    provider: text(caps.provider, 64, 1),
    connected: bool(caps.connected),
    productionEnabled: bool(caps.productionEnabled),
    idempotentSubmission: bool(caps.idempotentSubmission),
    supportsCancellation: bool(caps.supportsCancellation),
    supportsDestinationTokenization: bool(caps.supportsDestinationTokenization),
    webhookVerification: known(caps.webhookVerification, ["CRYPTOGRAPHIC", "UNSUPPORTED"]),
    retryPolicy: {
      maxSubmissionAttempts: count(retry.maxSubmissionAttempts),
      baseDelaySeconds: count(retry.baseDelaySeconds),
      maxDelaySeconds: count(retry.maxDelaySeconds),
      sameIdempotencyKeyAcrossRetries: bool(retry.sameIdempotencyKeyAcrossRetries),
    },
    paidConfirmation: known(caps.paidConfirmation, ["STATUS_OR_VERIFIED_WEBHOOK_ONLY"]),
    rawBankSecretsSentByThisAdapter: false,
  };
  const transfer = row.transfer === null ? null : object(row.transfer);
  if (transfer && id(transfer.payoutId) !== detail.payoutId) throw invalid();
  return {
    payout: {
      id: detail.payoutId,
      provider: detail.provider,
      amount,
      currency: detail.currency,
      status: known(payout.status, financePayoutStates),
      externalReference: nullable(payout.externalReference),
    },
    capabilities,
    transfer: transfer
      ? {
          id: id(transfer.id),
          state: known(transfer.state, transferStates),
          externalTransferId: nullable(transfer.externalTransferId, 255),
          providerResponseState: nullable(transfer.providerResponseState, 120),
          submitAttempts: count(transfer.submitAttempts),
          statusAttempts: count(transfer.statusAttempts),
          cancelAttempts: count(transfer.cancelAttempts),
          nextRetryAt: nullableDate(transfer.nextRetryAt),
        }
      : null,
  };
}
export function parsePayoutReveal(v: unknown, detail: PayoutDetail) {
  const row = object(v);
  if (
    id(row.payoutId) !== detail.payoutId ||
    id(row.channelId) !== detail.channel.id ||
    row.provider !== "MANUAL" ||
    detail.provider !== "MANUAL" ||
    row.sensitive !== true ||
    row.cacheable !== false
  )
    throw invalid();
  const profile = detail.paymentProfile;
  if (
    profile &&
    (row.legalName !== profile.legalName ||
      row.countryCode !== profile.countryCode ||
      row.destinationMask !== profile.destinationMask)
  )
    throw invalid();
  return {
    payoutId: detail.payoutId,
    provider: "MANUAL",
    legalName: text(row.legalName, 255, 1),
    countryCode: nullable(row.countryCode, 2),
    destination: text(row.destination, 10000, 1),
    destinationMask: nullable(row.destinationMask, 255),
    sensitive: true as const,
    cacheable: false as const,
  };
}
export type PayoutReveal = ReturnType<typeof parsePayoutReveal>;
async function request(path: string, signal: AbortSignal, body?: object) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    signal,
    ...(body
      ? {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });
  if (!response.ok) {
    const verificationRequired = await adminVerificationRequired(response);
    await readAdminApiError(response);
    throw new PayoutWorkspaceError(response.status, Boolean(body), verificationRequired);
  }
  return (await response.json()) as unknown;
}
async function bounded<T>(
  signal: AbortSignal,
  timeout: number,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener("abort", abort);
  }
}
async function session(signal: AbortSignal, expected?: AdminSession) {
  const actual = parsePayoutSession(await getAdminSession(signal));
  if (!canManageFinance(actual.roles)) throw new PayoutWorkspaceError(403);
  if (expected) match(expected, actual);
  return actual;
}
export async function readPayoutWorkspace(
  payoutId: string,
  signal: AbortSignal,
  expected?: AdminSession,
) {
  return bounded(signal, 15000, async (signal) => {
    const actor = await session(signal, expected),
      target = id(payoutId);
    const detail = parsePayoutDetail(
      await request(`/admin/revenue/payouts/${target}`, signal),
      target,
    );
    const provider = parsePayoutProvider(
      await request(`/admin/revenue/payouts/${target}/provider`, signal),
      detail,
    );
    if (provider.payout.status !== detail.status) throw invalid();
    match(actor, await session(signal));
    return { actor, detail, provider };
  });
}
export type PayoutWorkspace = Awaited<ReturnType<typeof readPayoutWorkspace>>;
export type PayoutAction = "reveal" | "submit" | "status" | "cancel";
export async function writePayoutWorkspace(
  action: PayoutAction,
  snapshot: PayoutWorkspace,
  reason: string,
  signal: AbortSignal,
) {
  let started = false;
  try {
    const trimmed = text(reason.trim(), 500, 8);
    return await bounded(signal, 30000, async (signal) => {
      const actor = await session(signal, snapshot.actor),
        payoutId = id(snapshot.detail.payoutId);
      const path =
        action === "reveal"
          ? `/admin/revenue/payouts/${payoutId}/destination`
          : `/admin/revenue/payouts/${payoutId}/provider/${action}`;
      started = true;
      const payload = await request(path, signal, { reason: trimmed });
      const result =
        action === "reveal"
          ? { kind: "reveal" as const, value: parsePayoutReveal(payload, snapshot.detail) }
          : { kind: "provider" as const, value: parsePayoutProvider(payload, snapshot.detail) };
      match(actor, await session(signal));
      return result;
    });
  } catch (error) {
    if (error instanceof PayoutWorkspaceError)
      throw new PayoutWorkspaceError(error.status, started, error.verificationRequired);
    throw new PayoutWorkspaceError(0, started);
  }
}
