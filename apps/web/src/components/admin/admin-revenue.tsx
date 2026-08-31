"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";
import {
  addRevenueAdjustment,
  createChannelContract,
  getAdminFinanceSummary,
  getAdminLedger,
  getAdminPayouts,
  getAdminRevenueDisputes,
  getAdminRevenueSettings,
  updateAdminRevenueDispute,
  updateAdminRevenueSettings,
  updatePayoutStatus,
  type AdminRevenueDispute,
  type AdminRevenueSettings,
} from "@/lib/revenue";

type LedgerData = Awaited<ReturnType<typeof getAdminLedger>>;
type PayoutData = Awaited<ReturnType<typeof getAdminPayouts>>;
type FinanceSummary = Awaited<ReturnType<typeof getAdminFinanceSummary>>;
type PayoutAction = { reason: string; externalReference: string; failureReason: string };
type DisputeAction = { reason: string; resolution: string };

async function createPayout(channelId: string, currency: string) {
  const response = await fetch(`${apiBaseUrl}/admin/revenue/payouts`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId, currency }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
}

function payoutActionFor(actions: Record<string, PayoutAction>, id: string): PayoutAction {
  return actions[id] ?? { reason: "", externalReference: "", failureReason: "" };
}

function disputeActionFor(actions: Record<string, DisputeAction>, id: string): DisputeAction {
  return actions[id] ?? { reason: "", resolution: "" };
}

export function AdminRevenue() {
  const [settings, setSettings] = useState<AdminRevenueSettings | null>(null);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [payouts, setPayouts] = useState<PayoutData | null>(null);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [disputes, setDisputes] = useState<AdminRevenueDispute[]>([]);
  const [channelId, setChannelId] = useState("");
  const [shareBps, setShareBps] = useState("5500");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reason, setReason] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [payoutStatus, setPayoutStatus] = useState("");
  const [disputeStatus, setDisputeStatus] = useState("");
  const [payoutActions, setPayoutActions] = useState<Record<string, PayoutAction>>({});
  const [disputeActions, setDisputeActions] = useState<Record<string, DisputeAction>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const ledgerParams = new URLSearchParams();
      if (filterChannel.trim()) ledgerParams.set("channelId", filterChannel.trim());
      const payoutParams = new URLSearchParams();
      if (payoutStatus) payoutParams.set("status", payoutStatus);
      const [nextSettings, nextLedger, nextPayouts, nextFinance, nextDisputes] =
        await Promise.all([
          getAdminRevenueSettings(),
          getAdminLedger(ledgerParams),
          getAdminPayouts(payoutParams),
          getAdminFinanceSummary(),
          getAdminRevenueDisputes(disputeStatus || undefined),
        ]);
      setSettings(nextSettings);
      setLedger(nextLedger);
      setPayouts(nextPayouts);
      setFinance(nextFinance);
      setDisputes(nextDisputes);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Revenue controls could not be loaded.");
    }
  }, [disputeStatus, filterChannel, payoutStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Revenue change was not saved.");
    } finally {
      setBusy(false);
    }
  }

  function setPayoutField(id: string, field: keyof PayoutAction, value: string) {
    setPayoutActions((current) => ({
      ...current,
      [id]: { ...payoutActionFor(current, id), [field]: value },
    }));
  }

  function setDisputeField(id: string, field: keyof DisputeAction, value: string) {
    setDisputeActions((current) => ({
      ...current,
      [id]: { ...disputeActionFor(current, id), [field]: value },
    }));
  }

  return (
    <div className={styles.grid}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>AYIN Monetization</span>
          <h1>Revenue Control Center</h1>
          <p className={styles.muted}>
            Contract splits, append-only earnings, creator payout requests, disputes and audited payment operations.
          </p>
        </div>
        <span className={styles.statusPill}>Manual payout V1</span>
      </header>

      {message ? <p className={styles.notice} role="status">{message}</p> : null}

      {finance ? (
        <section aria-label="Revenue operations summary" className={styles.metrics}>
          <article className={styles.metric}><span className={styles.muted}>Pending payouts</span><strong>{finance.pendingPayouts}</strong></article>
          <article className={styles.metric}><span className={styles.muted}>Processing</span><strong>{finance.processingPayouts}</strong></article>
          <article className={styles.metric}><span className={styles.muted}>Open disputes</span><strong>{finance.openDisputes}</strong></article>
          <article className={styles.metric}><span className={styles.muted}>Payout mode</span><strong>Manual</strong></article>
        </section>
      ) : null}

      <section className={styles.card}>
        <h2>Global revenue defaults</h2>
        {settings ? (
          <form
            className={styles.toolbar}
            onSubmit={(event) => {
              event.preventDefault();
              void act(() => updateAdminRevenueSettings(settings), "Revenue defaults updated.");
            }}
          >
            <label>
              Default creator share (bps)
              <input
                type="number"
                min="0"
                max="10000"
                value={settings.defaultCreatorRevenueShareBps}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? { ...current, defaultCreatorRevenueShareBps: Number(event.target.value) }
                      : current,
                  )
                }
              />
            </label>
            <label>
              Payout threshold (currency micros)
              <input
                inputMode="numeric"
                value={settings.payoutThresholdMicros}
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, payoutThresholdMicros: event.target.value } : current,
                  )
                }
              />
            </label>
            <button className={styles.button} disabled={busy} type="submit">Save defaults</button>
          </form>
        ) : null}
      </section>

      <div className={styles.commandGrid}>
        <section className={styles.card}>
          <h2>Per-channel contract</h2>
          <form
            className={styles.grid}
            onSubmit={(event) => {
              event.preventDefault();
              if (!channelId) return;
              void act(
                () => createChannelContract(channelId, {
                  revenueShareBps: Number(shareBps),
                  effectiveFrom: new Date().toISOString(),
                  termsVersion: "admin-v1",
                }),
                "Channel contract override created.",
              );
            }}
          >
            <input aria-label="Channel ID" placeholder="Channel UUID" value={channelId} onChange={(event) => setChannelId(event.target.value)} />
            <input aria-label="Revenue share basis points" type="number" min="0" max="10000" value={shareBps} onChange={(event) => setShareBps(event.target.value)} />
            <button className={styles.button} disabled={busy || !channelId} type="submit">Create effective override</button>
          </form>
        </section>

        <section className={styles.card}>
          <h2>Manual adjustment</h2>
          <p className={styles.muted}>Append-only: historical earnings are never rewritten.</p>
          <form
            className={styles.grid}
            onSubmit={(event) => {
              event.preventDefault();
              if (!channelId || !amount || reason.trim().length < 8) return;
              void act(() => addRevenueAdjustment({ channelId, amount, currency, reason }), "Adjustment appended and audited.");
            }}
          >
            <input aria-label="Adjustment amount" placeholder="10.000000 or -10.000000" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <input aria-label="Currency" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            <textarea aria-label="Adjustment reason" minLength={8} placeholder="Mandatory operator reason" value={reason} onChange={(event) => setReason(event.target.value)} />
            <button className={styles.button} disabled={busy || reason.trim().length < 8} type="submit">Append adjustment</button>
          </form>
        </section>

        <section className={styles.card}>
          <h2>Admin-created payout</h2>
          <p className={styles.muted}>Creates an auditable manual payout record from finalized eligible ledger balance.</p>
          <button
            className={styles.button}
            type="button"
            disabled={!channelId || busy}
            onClick={() => void act(() => createPayout(channelId, currency), "Payout record created from finalized balance.")}
          >
            Create payout for channel
          </button>
        </section>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Payout operations</h2>
            <p className={styles.muted}>All impactful status changes require an operator reason. External payment references are stored only when supplied.</p>
          </div>
          <select aria-label="Payout status filter" value={payoutStatus} onChange={(event) => setPayoutStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="PROCESSING">Processing</option>
            <option value="PAID">Paid</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div className={styles.grid}>
          {payouts?.items.map((payout) => {
            const action = payoutActionFor(payoutActions, payout.id);
            return (
              <article className={styles.card} key={payout.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <strong>{payout.channel.name}</strong>
                    <p>{payout.currency} {payout.amount} · <span className={styles.statusPill}>{payout.status}</span></p>
                    <p className={styles.muted}>Requested {new Date(payout.requestedAt).toLocaleString()}</p>
                  </div>
                  {payout.externalReference ? <span className={styles.muted}>Ref: {payout.externalReference}</span> : null}
                </div>
                {(payout.status === "PENDING" || payout.status === "PROCESSING") ? (
                  <div className={styles.grid}>
                    <textarea
                      aria-label={`Operator reason for payout ${payout.id}`}
                      minLength={8}
                      placeholder="Mandatory operator reason"
                      value={action.reason}
                      onChange={(event) => setPayoutField(payout.id, "reason", event.target.value)}
                    />
                    {payout.status === "PROCESSING" ? (
                      <>
                        <input
                          aria-label={`External reference for payout ${payout.id}`}
                          placeholder="External payment reference (recommended when paid)"
                          value={action.externalReference}
                          onChange={(event) => setPayoutField(payout.id, "externalReference", event.target.value)}
                        />
                        <input
                          aria-label={`Failure reason for payout ${payout.id}`}
                          placeholder="Failure reason when failing payout"
                          value={action.failureReason}
                          onChange={(event) => setPayoutField(payout.id, "failureReason", event.target.value)}
                        />
                      </>
                    ) : null}
                    <div className={styles.actions}>
                      {payout.status === "PENDING" ? (
                        <>
                          <button className={styles.button} disabled={busy || action.reason.trim().length < 8} type="button" onClick={() => void act(() => updatePayoutStatus(payout.id, "PROCESSING", action.reason), "Payout moved to processing.")}>Start processing</button>
                          <button className={styles.danger} disabled={busy || action.reason.trim().length < 8} type="button" onClick={() => void act(() => updatePayoutStatus(payout.id, "CANCELLED", action.reason), "Payout cancelled and eligible balance released.")}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className={styles.button} disabled={busy || action.reason.trim().length < 8} type="button" onClick={() => void act(() => updatePayoutStatus(payout.id, "PAID", action.reason, { externalReference: action.externalReference || null }), "Payout marked paid.")}>Mark paid</button>
                          <button className={styles.danger} disabled={busy || action.reason.trim().length < 8 || action.failureReason.trim().length < 3} type="button" onClick={() => void act(() => updatePayoutStatus(payout.id, "FAILED", action.reason, { failureReason: action.failureReason }), "Payout marked failed and eligible balance released.")}>Fail payout</button>
                          <button className={styles.danger} disabled={busy || action.reason.trim().length < 8} type="button" onClick={() => void act(() => updatePayoutStatus(payout.id, "CANCELLED", action.reason), "Payout cancelled and eligible balance released.")}>Cancel</button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
                {payout.failureReason ? <p className={styles.error}>Failure: {payout.failureReason}</p> : null}
              </article>
            );
          })}
          {payouts && payouts.items.length === 0 ? <p className={styles.muted}>No payouts match this filter.</p> : null}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Creator revenue disputes</h2>
            <p className={styles.muted}>Review earnings and payout cases with an auditable resolution.</p>
          </div>
          <select aria-label="Revenue dispute status" value={disputeStatus} onChange={(event) => setDisputeStatus(event.target.value)}>
            <option value="">All disputes</option>
            <option value="OPEN">Open</option>
            <option value="REVIEWING">Reviewing</option>
            <option value="RESOLVED">Resolved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <div className={styles.grid}>
          {disputes.map((dispute) => {
            const action = disputeActionFor(disputeActions, dispute.id);
            const active = dispute.status === "OPEN" || dispute.status === "REVIEWING";
            return (
              <article className={styles.card} key={dispute.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <strong>{dispute.channelName}</strong> · @{dispute.channelHandle}
                    <p>{dispute.category} · <span className={styles.statusPill}>{dispute.status}</span></p>
                    <p className={styles.muted}>{dispute.creatorEmail}</p>
                  </div>
                  {dispute.payoutId ? <span className={styles.muted}>Payout {dispute.payoutCurrency} {dispute.payoutAmount} · {dispute.payoutStatus}</span> : null}
                </div>
                <p>{dispute.message}</p>
                {dispute.resolution ? <p><strong>Resolution:</strong> {dispute.resolution}</p> : null}
                {active ? (
                  <div className={styles.grid}>
                    <textarea minLength={8} placeholder="Resolution / review note" value={action.resolution} onChange={(event) => setDisputeField(dispute.id, "resolution", event.target.value)} />
                    <input minLength={8} placeholder="Mandatory audit reason" value={action.reason} onChange={(event) => setDisputeField(dispute.id, "reason", event.target.value)} />
                    <div className={styles.actions}>
                      {dispute.status === "OPEN" ? <button className={styles.button} disabled={busy || action.reason.trim().length < 8} type="button" onClick={() => void act(() => updateAdminRevenueDispute(dispute.id, { status: "REVIEWING", resolution: action.resolution || null, reason: action.reason }), "Dispute moved to review.")}>Start review</button> : null}
                      <button className={styles.button} disabled={busy || action.reason.trim().length < 8 || action.resolution.trim().length < 8} type="button" onClick={() => void act(() => updateAdminRevenueDispute(dispute.id, { status: "RESOLVED", resolution: action.resolution, reason: action.reason }), "Dispute resolved.")}>Resolve</button>
                      <button className={styles.danger} disabled={busy || action.reason.trim().length < 8 || action.resolution.trim().length < 8} type="button" onClick={() => void act(() => updateAdminRevenueDispute(dispute.id, { status: "REJECTED", resolution: action.resolution, reason: action.reason }), "Dispute closed as rejected.")}>Reject</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
          {disputes.length === 0 ? <p className={styles.muted}>No disputes match this filter.</p> : null}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div><h2>Ledger search</h2><p className={styles.muted}>Trace append-only revenue activity by channel UUID.</p></div>
        </div>
        <form className={styles.toolbar} onSubmit={(event) => { event.preventDefault(); void load(); }}>
          <input aria-label="Filter by channel ID" placeholder="Channel UUID" value={filterChannel} onChange={(event) => setFilterChannel(event.target.value)} />
          <button className={styles.button} type="submit">Search ledger</button>
        </form>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Channel</th><th>State</th><th>Amount</th><th>Attribution</th><th>Occurred</th></tr></thead>
            <tbody>
              {ledger?.items.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.channel.name}</td>
                  <td>{entry.state}</td>
                  <td>{entry.currency} {entry.amount}</td>
                  <td>{entry.video?.title ?? entry.campaign?.name ?? entry.adSource ?? entry.memo ?? entry.type}</td>
                  <td>{new Date(entry.occurredAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ledger && ledger.items.length === 0 ? <p className={styles.muted}>No matching ledger entries.</p> : null}
      </section>
    </div>
  );
}
