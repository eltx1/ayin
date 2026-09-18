"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";
import {
  cancelPayoutAtProvider,
  getPayoutProviderTransfer,
  refreshPayoutProviderStatus,
  submitPayoutToProvider,
  type PayoutProviderTransferView,
} from "@/lib/payout-provider";

type PayoutDetail = {
  payoutId: string;
  channel: { id: string; name: string; handle: string };
  status: string;
  provider: string;
  amount: string;
  currency: string;
  requestedAt: string;
  processedAt: string | null;
  paidAt: string | null;
  externalReference: string | null;
  failureReason: string | null;
  paymentProfile: {
    id: string;
    legalName: string | null;
    provider: string | null;
    destinationMask: string | null;
    countryCode: string | null;
    hasDestination: boolean;
  } | null;
  destinationRevealAllowed: boolean;
};

type RevealedDestination = {
  payoutId: string;
  provider: string;
  legalName: string;
  countryCode: string | null;
  destination: string;
  destinationMask: string | null;
  sensitive: true;
  cacheable: false;
};

async function payoutFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function AdminPayoutDetail({ payoutId }: { payoutId: string }) {
  const [detail, setDetail] = useState<PayoutDetail | null>(null);
  const [provider, setProvider] = useState<PayoutProviderTransferView | null>(null);
  const [revealed, setRevealed] = useState<RevealedDestination | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [nextDetail, nextProvider] = await Promise.all([
      payoutFetch<PayoutDetail>(`/admin/revenue/payouts/${encodeURIComponent(payoutId)}`),
      getPayoutProviderTransfer(payoutId),
    ]);
    setDetail(nextDetail);
    setProvider(nextProvider);
  }, [payoutId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      payoutFetch<PayoutDetail>(`/admin/revenue/payouts/${encodeURIComponent(payoutId)}`),
      getPayoutProviderTransfer(payoutId),
    ])
      .then(([nextDetail, nextProvider]) => {
        if (!active) return;
        setDetail(nextDetail);
        setProvider(nextProvider);
      })
      .catch((error) => {
        if (active)
          setMessage(error instanceof Error ? error.message : "Payout could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [payoutId]);

  async function reveal() {
    if (reason.trim().length < 8) return;
    setBusy(true);
    setMessage("");
    try {
      const value = await payoutFetch<RevealedDestination>(
        `/admin/revenue/payouts/${encodeURIComponent(payoutId)}/destination`,
        { method: "POST", body: JSON.stringify({ reason: reason.trim() }) },
      );
      setRevealed(value);
      setMessage("Sensitive payout destination revealed for this audited finance action only.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Destination could not be revealed.");
    } finally {
      setBusy(false);
    }
  }

  async function providerAction(
    action: (payoutId: string, reason: string) => Promise<PayoutProviderTransferView>,
    success: string,
  ) {
    if (reason.trim().length < 8) return;
    setBusy(true);
    setMessage("");
    try {
      await action(payoutId, reason.trim());
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider action failed.");
    } finally {
      setBusy(false);
    }
  }

  const providerReady = Boolean(
    provider?.capabilities.connected && provider.capabilities.productionEnabled,
  );
  const transferState = provider?.transfer?.state ?? "NOT_CREATED";
  const maySubmit =
    detail?.provider !== "MANUAL" &&
    providerReady &&
    (detail?.status === "PENDING" || transferState === "SUBMISSION_UNKNOWN");
  const mayRefresh =
    providerReady &&
    Boolean(provider?.transfer?.externalTransferId) &&
    !["COMPLETED", "FAILED", "CANCELLED"].includes(transferState);
  const mayCancel =
    detail?.provider !== "MANUAL" &&
    (detail?.status === "PENDING" ||
      (providerReady && !["COMPLETED", "FAILED", "CANCELLED"].includes(transferState)));

  return (
    <div className={styles.grid}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Finance Operations</span>
          <h1>Payout detail</h1>
          <p className={styles.muted}>
            Manual payout controls and provider-managed transfer diagnostics share the same
            immutable payout record. Provider submission never marks a payout paid.
          </p>
        </div>
        <Link className={styles.button} href="/admin/revenue">
          Back to revenue
        </Link>
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}

      {detail ? (
        <>
          <section className={styles.metrics} aria-label="Payout summary">
            <article className={styles.metric}>
              <span className={styles.muted}>Amount</span>
              <strong>
                {detail.currency} {detail.amount}
              </strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Status</span>
              <strong>{detail.status}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Provider</span>
              <strong>{detail.provider}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Channel</span>
              <strong>@{detail.channel.handle}</strong>
            </article>
          </section>

          <section className={styles.card}>
            <h2>Operational context</h2>
            <div className={styles.grid}>
              <p>
                <strong>Channel:</strong> {detail.channel.name} (@{detail.channel.handle})
              </p>
              <p>
                <strong>Requested:</strong> {displayDate(detail.requestedAt)}
              </p>
              <p>
                <strong>Processing:</strong> {displayDate(detail.processedAt)}
              </p>
              <p>
                <strong>Paid:</strong> {displayDate(detail.paidAt)}
              </p>
              <p>
                <strong>External reference:</strong> {detail.externalReference ?? "—"}
              </p>
              <p>
                <strong>Failure reason:</strong> {detail.failureReason ?? "—"}
              </p>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2>External payout provider</h2>
                <p className={styles.muted}>
                  Provider state is separate from AYIN payout state. PAID is only written after a
                  confirmed provider completion from status retrieval or a verified webhook.
                </p>
              </div>
              <span className={styles.statusPill}>
                {providerReady ? "Production enabled" : "Production disabled"}
              </span>
            </div>
            <div className={styles.grid}>
              <p>
                <strong>Configured adapter:</strong>{" "}
                {provider?.capabilities.provider ?? "Unavailable"}
              </p>
              <p>
                <strong>Transfer state:</strong> {transferState}
              </p>
              <p>
                <strong>External transfer ID:</strong>{" "}
                {provider?.transfer?.externalTransferId ?? "—"}
              </p>
              <p>
                <strong>Provider response state:</strong>{" "}
                {provider?.transfer?.providerResponseState ?? "—"}
              </p>
              <p>
                <strong>Attempts:</strong> submit {provider?.transfer?.submitAttempts ?? 0} · status{" "}
                {provider?.transfer?.statusAttempts ?? 0} · cancel{" "}
                {provider?.transfer?.cancelAttempts ?? 0}
              </p>
              <p>
                <strong>Next safe retry:</strong>{" "}
                {provider?.transfer?.nextRetryAt
                  ? new Date(provider.transfer.nextRetryAt).toLocaleString()
                  : "—"}
              </p>
            </div>
            {!providerReady ? (
              <p className={styles.muted}>
                No approved external provider/account is configured. AYIN will not submit a real
                transfer until a provider adapter is connected and explicitly production-enabled.
              </p>
            ) : null}
            <textarea
              aria-label="Provider action reason"
              minLength={8}
              placeholder="Mandatory finance reason for provider action"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={busy || !maySubmit || reason.trim().length < 8}
                type="button"
                onClick={() =>
                  void providerAction(
                    submitPayoutToProvider,
                    "Payout submission was acknowledged; payment remains unconfirmed.",
                  )
                }
              >
                Submit / safe retry
              </button>
              <button
                className={styles.button}
                disabled={busy || !mayRefresh || reason.trim().length < 8}
                type="button"
                onClick={() =>
                  void providerAction(
                    refreshPayoutProviderStatus,
                    "Provider transfer status refreshed.",
                  )
                }
              >
                Refresh provider status
              </button>
              <button
                className={styles.danger}
                disabled={busy || !mayCancel || reason.trim().length < 8}
                type="button"
                onClick={() =>
                  void providerAction(cancelPayoutAtProvider, "Provider cancellation processed.")
                }
              >
                Cancel through provider
              </button>
            </div>
          </section>

          <section className={styles.card}>
            <h2>Beneficiary</h2>
            <p>
              <strong>Legal name:</strong> {detail.paymentProfile?.legalName ?? "Not configured"}
            </p>
            <p>
              <strong>Destination:</strong>{" "}
              {detail.paymentProfile?.destinationMask ?? "Not configured"}
            </p>
            <p>
              <strong>Country / region:</strong> {detail.paymentProfile?.countryCode ?? "—"}
            </p>
            <p className={styles.muted}>
              Full destination instructions are never included in ordinary payout APIs. External
              provider automation uses only a provider-issued token stored encrypted when
              tokenization is supported.
            </p>

            {detail.destinationRevealAllowed ? (
              <div className={styles.grid}>
                <textarea
                  aria-label="Reason for revealing payout destination"
                  minLength={8}
                  placeholder="Mandatory finance reason, e.g. Executing approved manual payout"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <button
                  className={styles.danger}
                  disabled={busy || reason.trim().length < 8}
                  onClick={() => void reveal()}
                  type="button"
                >
                  Reveal sensitive destination
                </button>
              </div>
            ) : (
              <p className={styles.muted}>
                Raw destination reveal is unavailable for this payout status or provider.
              </p>
            )}
          </section>

          {revealed ? (
            <section className={styles.card}>
              <h2>Sensitive destination — do not copy into logs</h2>
              <p>
                <strong>{revealed.legalName}</strong>
              </p>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {revealed.destination}
              </pre>
              <p className={styles.muted}>
                This response is marked no-store and the reveal event has been audited. Close or
                leave this page when the manual payment action is complete.
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
