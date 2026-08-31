"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";

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
  const [revealed, setRevealed] = useState<RevealedDestination | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void payoutFetch<PayoutDetail>(`/admin/revenue/payouts/${encodeURIComponent(payoutId)}`)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Payout could not be loaded.");
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

  return (
    <div className={styles.grid}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Finance Operations</span>
          <h1>Manual payout detail</h1>
          <p className={styles.muted}>
            Safe payout context with an explicit, audited reveal boundary for actionable destination
            instructions.
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
              Full destination instructions are never included in ordinary payout APIs. Revealing
              them requires finance permission, a reason and creates an audit-log entry.
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
                Destination reveal is unavailable for this payout status or provider.
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
