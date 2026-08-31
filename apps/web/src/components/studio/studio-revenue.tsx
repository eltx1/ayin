"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import {
  createCreatorRevenueDispute,
  getCreatorRevenue,
  getCreatorRevenueDisputes,
  requestCreatorPayout,
  updateCreatorPaymentProfile,
  type CreatorRevenueOverview,
  type RevenueDispute,
} from "@/lib/revenue";

function money(currency: string, value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${currency} ${value}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(number);
  } catch {
    return `${currency} ${number.toFixed(2)}`;
  }
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function StudioRevenue() {
  const [overview, setOverview] = useState<CreatorRevenueOverview | null>(null);
  const [disputes, setDisputes] = useState<RevenueDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [preferredCurrency, setPreferredCurrency] = useState("USD");
  const [destination, setDestination] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [disputeCategory, setDisputeCategory] = useState<"EARNINGS" | "PAYOUT" | "OTHER">(
    "EARNINGS",
  );
  const [disputePayoutId, setDisputePayoutId] = useState("");
  const [disputeMessage, setDisputeMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, nextDisputes] = await Promise.all([
        getCreatorRevenue(),
        getCreatorRevenueDisputes(),
      ]);
      setOverview(nextOverview);
      setDisputes(nextDisputes.items);
      const profile = nextOverview.paymentProfile;
      if (profile) {
        setLegalName(profile.legalName);
        setPreferredCurrency(profile.preferredCurrency);
        setCountryCode(profile.countryCode ?? "");
      } else {
        setPreferredCurrency(nextOverview.currency || "USD");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Monetization data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => {
    if (!overview) return [];
    return [
      ["Estimated", money(overview.currency, overview.estimatedRevenue)],
      ["Finalized", money(overview.currency, overview.finalizedRevenue)],
      ["Available", money(overview.currency, overview.availableForPayout)],
      ["On hold", money(overview.currency, overview.onHoldForPayout)],
      ["Creator share", `${(overview.contract.revenueShareBps / 100).toFixed(2)}%`],
    ];
  }, [overview]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The monetization change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading && !overview) return <p className={styles.muted}>Loading monetization…</p>;
  if (!overview) return <p className={styles.error}>{message || "Revenue data is unavailable."}</p>;

  const profile = overview.paymentProfile;

  return (
    <div>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Monetization</span>
          <h1>Revenue & payouts</h1>
          <p className={styles.muted}>
            Earnings, payout readiness, payment profile, statements and revenue support in one
            place.
          </p>
        </div>
        <span className={styles.statusPill}>Manual payout V1</span>
      </header>

      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}

      <section aria-label="Revenue summary" className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <article className={styles.metric} key={label}>
            <span className={styles.muted}>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>Payout readiness</h2>
          <p className={styles.muted}>
            Threshold: {money(overview.currency, overview.payoutThreshold)} · Current available
            balance: {money(overview.currency, overview.availableForPayout)}
          </p>
          <div
            aria-label={`${overview.payoutProgressPercent.toFixed(0)}% of payout threshold`}
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overview.payoutProgressPercent)}
          >
            <div
              className={styles.progressBar}
              style={{ width: `${Math.min(100, overview.payoutProgressPercent)}%` }}
            />
          </div>
          <ul className={styles.list}>
            <li>
              <span>Payment profile</span>
              <strong>{overview.payoutReadiness.profileReady ? "Ready" : "Action needed"}</strong>
            </li>
            <li>
              <span>Threshold</span>
              <strong>{overview.payoutReadiness.thresholdMet ? "Reached" : "Not reached"}</strong>
            </li>
            <li>
              <span>Existing payout</span>
              <strong>{overview.payoutReadiness.openPayout ? "In progress" : "None"}</strong>
            </li>
            <li>
              <span>Provider</span>
              <strong>Manual review</strong>
            </li>
          </ul>
          <button
            className={styles.primary}
            disabled={!overview.canRequestPayout || busy}
            onClick={() =>
              void act(
                () => requestCreatorPayout(preferredCurrency),
                "Payout request submitted for manual review.",
              )
            }
            type="button"
          >
            Request payout
          </button>
          <p className={styles.muted}>
            Bank, PayPal, Payoneer and Wise adapters are intentionally not shown as connected. AYIN
            V1 uses audited manual payout processing.
          </p>
        </section>

        <section className={styles.panel}>
          <h2>Contract & revenue share</h2>
          <ul className={styles.list}>
            <li>
              <span>Effective creator share</span>
              <strong>{(overview.contract.revenueShareBps / 100).toFixed(2)}%</strong>
            </li>
            <li>
              <span>Source</span>
              <strong>
                {overview.contract.source === "CHANNEL_OVERRIDE"
                  ? "Channel contract"
                  : "Platform default"}
              </strong>
            </li>
            <li>
              <span>Effective from</span>
              <strong>{date(overview.contract.effectiveFrom)}</strong>
            </li>
            <li>
              <span>Currency</span>
              <strong>{overview.currency}</strong>
            </li>
          </ul>
        </section>
      </div>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Payment profile</h2>
            <p className={styles.muted}>
              Destination details are encrypted at rest and only the masked value is returned after
              saving.
            </p>
          </div>
          {profile?.destinationMask ? (
            <span className={styles.statusPill}>{profile.destinationMask}</span>
          ) : null}
        </div>
        <form
          className={styles.formGrid}
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              () =>
                updateCreatorPaymentProfile({
                  legalName,
                  preferredCurrency,
                  provider: "MANUAL",
                  ...(destination.trim() ? { destination: destination.trim() } : {}),
                  countryCode: countryCode.trim() ? countryCode.trim().toUpperCase() : null,
                }),
              "Payment profile saved securely.",
            ).then(() => setDestination(""));
          }}
        >
          <label>
            Legal beneficiary name
            <input
              required
              maxLength={160}
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
            />
          </label>
          <label>
            Preferred currency
            <input
              required
              maxLength={3}
              value={preferredCurrency}
              onChange={(event) => setPreferredCurrency(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Country / region code
            <input
              maxLength={2}
              placeholder="US"
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Payment method
            <select value="MANUAL" disabled>
              <option value="MANUAL">Manual payout review</option>
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            {profile?.hasDestination
              ? "Replace payout destination (leave blank to keep current)"
              : "Payout destination details"}
            <textarea
              required={!profile?.hasDestination}
              maxLength={1500}
              placeholder="Bank transfer instructions or another approved manual-payout destination. Do not enter card data."
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            />
          </label>
          <div className={styles.actions} style={{ gridColumn: "1 / -1" }}>
            <button className={styles.primary} disabled={busy} type="submit">
              Save payment profile
            </button>
            <span className={styles.muted}>
              Identity: {profile?.identityStatus ?? "NOT_STARTED"} · Tax:{" "}
              {profile?.taxStatus ?? "NOT_PROVIDED"}
            </span>
          </div>
        </form>
      </section>

      <div className={styles.grid} style={{ marginTop: 18 }}>
        <section className={styles.panel}>
          <h2>Revenue by month</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Estimated</th>
                  <th>Finalized</th>
                </tr>
              </thead>
              <tbody>
                {overview.byPeriod.map((item) => (
                  <tr key={item.period}>
                    <td>{item.period}</td>
                    <td>{money(overview.currency, item.estimated)}</td>
                    <td>{money(overview.currency, item.finalized)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overview.byPeriod.length === 0 ? (
            <p className={styles.muted}>No attributable revenue periods yet.</p>
          ) : null}
        </section>

        <section className={styles.panel}>
          <h2>Revenue by video</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Estimated</th>
                  <th>Finalized</th>
                </tr>
              </thead>
              <tbody>
                {overview.byVideo.map((item) => (
                  <tr key={item.videoId}>
                    <td>{item.title}</td>
                    <td>{money(overview.currency, item.estimated)}</td>
                    <td>{money(overview.currency, item.finalized)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overview.byVideo.length === 0 ? (
            <p className={styles.muted}>No video-level revenue attribution yet.</p>
          ) : null}
        </section>
      </div>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <h2>Payout history</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Requested</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {overview.payouts.map((payout) => (
                <tr key={payout.id}>
                  <td>{date(payout.requestedAt)}</td>
                  <td>{money(payout.currency, payout.amount)}</td>
                  <td>
                    <span className={styles.statusPill}>{payout.status}</span>
                  </td>
                  <td>{date(payout.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {overview.payouts.length === 0 ? (
          <p className={styles.muted}>No payouts requested yet.</p>
        ) : null}
      </section>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <h2>Revenue support & disputes</h2>
        <p className={styles.muted}>Open a traceable case if an earning or payout needs review.</p>
        <form
          className={styles.formGrid}
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              () =>
                createCreatorRevenueDispute({
                  category: disputeCategory,
                  ...(disputePayoutId ? { payoutId: disputePayoutId } : {}),
                  message: disputeMessage,
                }),
              "Revenue dispute opened for review.",
            ).then(() => setDisputeMessage(""));
          }}
        >
          <label>
            Category
            <select
              value={disputeCategory}
              onChange={(event) => setDisputeCategory(event.target.value as typeof disputeCategory)}
            >
              <option value="EARNINGS">Earnings</option>
              <option value="PAYOUT">Payout</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            Related payout (optional)
            <select
              value={disputePayoutId}
              onChange={(event) => setDisputePayoutId(event.target.value)}
            >
              <option value="">No specific payout</option>
              {overview.payouts.map((payout) => (
                <option value={payout.id} key={payout.id}>
                  {date(payout.requestedAt)} · {money(payout.currency, payout.amount)} ·{" "}
                  {payout.status}
                </option>
              ))}
            </select>
          </label>
          <textarea
            required
            minLength={20}
            maxLength={5000}
            placeholder="Explain what should be reviewed and include the relevant period, video or payout context."
            value={disputeMessage}
            onChange={(event) => setDisputeMessage(event.target.value)}
          />
          <div className={styles.actions} style={{ gridColumn: "1 / -1" }}>
            <button
              className={styles.secondary}
              disabled={busy || disputeMessage.trim().length < 20}
              type="submit"
            >
              Open dispute
            </button>
          </div>
        </form>
        <ul className={styles.list}>
          {disputes.map((dispute) => (
            <li key={dispute.id}>
              <span>
                <strong>{dispute.category}</strong>
                <br />
                <span className={styles.muted}>{dispute.message}</span>
                {dispute.resolution ? (
                  <>
                    <br />
                    <span>Resolution: {dispute.resolution}</span>
                  </>
                ) : null}
              </span>
              <span className={styles.statusPill}>{dispute.status}</span>
            </li>
          ))}
        </ul>
        {disputes.length === 0 ? <p className={styles.muted}>No revenue disputes.</p> : null}
      </section>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <h2>Recent ledger activity</h2>
        <ul className={styles.list}>
          {overview.recentLedger.map((entry) => (
            <li key={entry.id}>
              <span>
                {entry.video?.title ?? entry.memo ?? entry.type}
                <br />
                <span className={styles.muted}>
                  {new Date(entry.occurredAt).toLocaleString()} · {entry.state}
                </span>
              </span>
              <strong>{money(entry.currency, entry.amount)}</strong>
            </li>
          ))}
        </ul>
        {overview.recentLedger.length === 0 ? (
          <p className={styles.muted}>No ledger activity yet.</p>
        ) : null}
      </section>
    </div>
  );
}
