"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import {
  createCreatorRevenueDispute,
  downloadCreatorStatement,
  getCreatorRevenue,
  getCreatorRevenueDisputes,
  requestCreatorPayout,
  updateCreatorPaymentProfile,
  type CreatorRevenueOverview,
  type RevenueDispute,
} from "@/lib/revenue";

type PayoutMethod = "BANK_TRANSFER" | "PAYPAL" | "PAYONEER" | "WISE" | "OTHER";

const payoutMethodLabels: Record<PayoutMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  PAYPAL: "PayPal",
  PAYONEER: "Payoneer",
  WISE: "Wise",
  OTHER: "Other",
};

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

function friendlyPayoutStatus(status: string) {
  const labels: Record<string, string> = {
    PENDING: "Requested",
    PROCESSING: "Processing",
    PAID: "Paid",
    FAILED: "Needs attention",
    CANCELLED: "Cancelled",
  };
  return labels[status] ?? status.replaceAll("_", " ").toLowerCase();
}

function profileState(value: string | undefined) {
  if (!value || value === "NOT_STARTED" || value === "NOT_PROVIDED") return "Not completed";
  if (value === "REQUIRES_ACTION") return "Action needed";
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function AccountRevenue() {
  const [overview, setOverview] = useState<CreatorRevenueOverview | null>(null);
  const [disputes, setDisputes] = useState<RevenueDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [preferredCurrency, setPreferredCurrency] = useState("USD");
  const [countryCode, setCountryCode] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>("BANK_TRANSFER");
  const [destination, setDestination] = useState("");
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
      setMessage(error instanceof Error ? error.message : "Earnings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const metrics = useMemo(() => {
    if (!overview) return [];
    return [
      ["Estimated earnings", money(overview.currency, overview.estimatedRevenue)],
      ["Finalized earnings", money(overview.currency, overview.finalizedRevenue)],
      ["Available to withdraw", money(overview.currency, overview.availableForPayout)],
      ["Pending", money(overview.currency, overview.onHoldForPayout)],
      ["Your revenue share", `${(overview.contract.revenueShareBps / 100).toFixed(2)}%`],
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
      setMessage(error instanceof Error ? error.message : "Your change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !overview) return <p className={styles.muted}>Loading earnings…</p>;
  if (!overview) return <p className={styles.error}>{message || "Earnings are unavailable."}</p>;

  const profile = overview.paymentProfile;
  const canRequest = overview.canRequestPayout;

  return (
    <div>
      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}

      <section aria-label="Earnings summary" className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <article className={styles.metric} key={label}>
            <span className={styles.muted}>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>Withdraw earnings</h2>
          <p className={styles.muted}>
            Minimum payout: {money(overview.currency, overview.payoutThreshold)} · Available now:{" "}
            {money(overview.currency, overview.availableForPayout)}
          </p>
          <div
            aria-label={`${overview.payoutProgressPercent.toFixed(0)}% of payout minimum`}
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
              <span>Payment details</span>
              <strong>{overview.payoutReadiness.profileReady ? "Ready" : "Complete details"}</strong>
            </li>
            <li>
              <span>Minimum payout</span>
              <strong>{overview.payoutReadiness.thresholdMet ? "Reached" : "Not reached yet"}</strong>
            </li>
            <li>
              <span>Current request</span>
              <strong>{overview.payoutReadiness.openPayout ? "In progress" : "None"}</strong>
            </li>
          </ul>
          <button
            className={styles.primary}
            disabled={!canRequest || busy}
            onClick={() =>
              void act(
                () => requestCreatorPayout(preferredCurrency),
                "Your payout request has been submitted.",
              )
            }
            type="button"
          >
            Request payout
          </button>
          {!canRequest ? (
            <p className={styles.muted}>
              Complete your payment details and reach the minimum payout before requesting a
              withdrawal. Only one payout request can be active at a time.
            </p>
          ) : null}
        </section>

        <section className={styles.panel}>
          <h2>Your revenue share</h2>
          <ul className={styles.list}>
            <li>
              <span>Creator share</span>
              <strong>{(overview.contract.revenueShareBps / 100).toFixed(2)}%</strong>
            </li>
            <li>
              <span>Currency</span>
              <strong>{overview.currency}</strong>
            </li>
            <li>
              <span>Effective from</span>
              <strong>{date(overview.contract.effectiveFrom)}</strong>
            </li>
          </ul>
          <button
            className={styles.secondary}
            disabled={busy}
            onClick={() =>
              void act(
                async () => {
                  await downloadCreatorStatement();
                },
                "Your earnings statement is ready.",
              )
            }
            type="button"
          >
            Download statement
          </button>
        </section>
      </div>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Payment details</h2>
            <p className={styles.muted}>
              Choose how you want to receive payouts and enter the destination details required for
              that method.
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
            const destinationValue = destination.trim()
              ? `${payoutMethodLabels[payoutMethod]}: ${destination.trim()}`
              : undefined;
            void act(
              () =>
                updateCreatorPaymentProfile({
                  legalName,
                  preferredCurrency,
                  provider: "MANUAL",
                  ...(destinationValue ? { destination: destinationValue } : {}),
                  countryCode: countryCode.trim() ? countryCode.trim().toUpperCase() : null,
                }),
              "Payment details saved.",
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
            Payout method
            <select
              value={payoutMethod}
              onChange={(event) => setPayoutMethod(event.target.value as PayoutMethod)}
            >
              {Object.entries(payoutMethodLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            {profile?.hasDestination
              ? "New payout destination (leave blank to keep your current one)"
              : "Payout destination"}
            <textarea
              required={!profile?.hasDestination}
              maxLength={1400}
              placeholder={
                payoutMethod === "BANK_TRANSFER"
                  ? "Bank name, account holder, account/IBAN and any required routing details. Do not enter card numbers."
                  : payoutMethod === "PAYPAL"
                    ? "PayPal account email"
                    : payoutMethod === "PAYONEER"
                      ? "Payoneer account email or approved receiving details"
                      : payoutMethod === "WISE"
                        ? "Wise account email or receiving account details"
                        : "Enter the approved payout destination details"
              }
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            />
          </label>
          <div className={styles.actions} style={{ gridColumn: "1 / -1" }}>
            <button className={styles.primary} disabled={busy} type="submit">
              Save payment details
            </button>
            <span className={styles.muted}>
              Identity: {profileState(profile?.identityStatus)} · Tax: {profileState(profile?.taxStatus)}
            </span>
          </div>
        </form>
      </section>

      <div className={styles.grid} style={{ marginTop: 18 }}>
        <section className={styles.panel}>
          <h2>Earnings by month</h2>
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
          {!overview.byPeriod.length ? <p className={styles.muted}>No earnings yet.</p> : null}
        </section>

        <section className={styles.panel}>
          <h2>Earnings by video</h2>
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
          {!overview.byVideo.length ? <p className={styles.muted}>No video earnings yet.</p> : null}
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
                    <span className={styles.statusPill}>{friendlyPayoutStatus(payout.status)}</span>
                  </td>
                  <td>{date(payout.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!overview.payouts.length ? <p className={styles.muted}>No payout requests yet.</p> : null}
      </section>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <h2>Earnings support</h2>
        <p className={styles.muted}>
          If an earning or payout looks wrong, send it for review and track the response here.
        </p>
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
              "Your review request has been submitted.",
            ).then(() => setDisputeMessage(""));
          }}
        >
          <label>
            Topic
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
                  {friendlyPayoutStatus(payout.status)}
                </option>
              ))}
            </select>
          </label>
          <textarea
            required
            minLength={20}
            maxLength={5000}
            placeholder="Tell us what should be reviewed. Include the relevant month, video or payout when possible."
            value={disputeMessage}
            onChange={(event) => setDisputeMessage(event.target.value)}
          />
          <div className={styles.actions} style={{ gridColumn: "1 / -1" }}>
            <button
              className={styles.secondary}
              disabled={busy || disputeMessage.trim().length < 20}
              type="submit"
            >
              Send for review
            </button>
          </div>
        </form>

        {disputes.length ? (
          <div className={styles.tableWrap} style={{ marginTop: 16 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Topic</th>
                  <th>Status</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((item) => (
                  <tr key={item.id}>
                    <td>{date(item.createdAt)}</td>
                    <td>{item.category.charAt(0) + item.category.slice(1).toLowerCase()}</td>
                    <td>{friendlyPayoutStatus(item.status)}</td>
                    <td>{item.resolution || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
