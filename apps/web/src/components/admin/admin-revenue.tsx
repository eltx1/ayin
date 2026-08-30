"use client";

import { useCallback, useEffect, useState } from "react";

import {
  addRevenueAdjustment,
  createChannelContract,
  getAdminLedger,
  getAdminPayouts,
  getAdminRevenueSettings,
  updateAdminRevenueSettings,
  updatePayoutStatus,
  type AdminRevenueSettings,
} from "@/lib/revenue";
import { apiBaseUrl, readApiError } from "@/lib/api";

type LedgerData = Awaited<ReturnType<typeof getAdminLedger>>;
type PayoutData = Awaited<ReturnType<typeof getAdminPayouts>>;

async function createPayout(channelId: string, currency: string) {
  const response = await fetch(`${apiBaseUrl}/admin/revenue/payouts`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId, currency }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
}

export function AdminRevenue() {
  const [settings, setSettings] = useState<AdminRevenueSettings | null>(null);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [payouts, setPayouts] = useState<PayoutData | null>(null);
  const [channelId, setChannelId] = useState("");
  const [shareBps, setShareBps] = useState("5500");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reason, setReason] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterChannel.trim()) params.set("channelId", filterChannel.trim());
      const [nextSettings, nextLedger, nextPayouts] = await Promise.all([
        getAdminRevenueSettings(),
        getAdminLedger(params),
        getAdminPayouts(),
      ]);
      setSettings(nextSettings);
      setLedger(nextLedger);
      setPayouts(nextPayouts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Revenue controls could not be loaded.");
    }
  }, [filterChannel]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Revenue change was not saved.");
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <header>
        <p>AYIN monetization</p>
        <h1>Revenue Control Center</h1>
        <p>Contract splits, append-only earnings, payout readiness and audited adjustments.</p>
      </header>
      {message ? <p role="status">{message}</p> : null}

      <section>
        <h2>Global defaults</h2>
        {settings ? (
          <form
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
            <button type="submit">Save defaults</button>
          </form>
        ) : null}
      </section>

      <section>
        <h2>Per-channel split</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!channelId) return;
            void act(
              () =>
                createChannelContract(channelId, {
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
          <button type="submit">Create effective override</button>
        </form>
      </section>

      <section>
        <h2>Manual adjustment</h2>
        <p>Adjustments append a new ledger entry; historical earnings are never rewritten.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!channelId || !amount || reason.trim().length < 8) return;
            void act(
              () => addRevenueAdjustment({ channelId, amount, currency, reason }),
              "Adjustment appended and audited.",
            );
          }}
        >
          <input aria-label="Adjustment amount" placeholder="10.000000 or -10.000000" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <input aria-label="Currency" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          <input aria-label="Adjustment reason" placeholder="Mandatory reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="submit">Append adjustment</button>
        </form>
      </section>

      <section>
        <h2>Ledger search</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input aria-label="Filter by channel ID" placeholder="Channel UUID" value={filterChannel} onChange={(event) => setFilterChannel(event.target.value)} />
          <button type="submit">Search ledger</button>
        </form>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {ledger?.items.map((entry) => (
            <article key={entry.id}>
              <strong>{entry.channel.name}</strong> · {entry.state} · {entry.currency} {entry.amount}
              {entry.video ? ` · ${entry.video.title}` : ""}
              {entry.campaign ? ` · ${entry.campaign.name}` : ""}
              {entry.adSource ? ` · ${entry.adSource}` : ""}
              {entry.memo ? ` · ${entry.memo}` : ""}
            </article>
          ))}
          {ledger && ledger.items.length === 0 ? <p>No matching ledger entries.</p> : null}
        </div>
      </section>

      <section>
        <h2>Payout readiness</h2>
        <p>Creates records only. No bank, wallet, card or payment provider is connected.</p>
        <button
          type="button"
          disabled={!channelId}
          onClick={() =>
            void act(() => createPayout(channelId, currency), "Payout record created from finalized balance.")
          }
        >
          Create payout record for channel
        </button>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {payouts?.items.map((payout) => (
            <article key={payout.id}>
              <strong>{payout.channel.name}</strong> · {payout.currency} {payout.amount} · {payout.status}{" "}
              {payout.status === "PENDING" ? (
                <button type="button" onClick={() => void act(() => updatePayoutStatus(payout.id, "PROCESSING", "Admin started payout processing"), "Payout moved to processing.")}>Process</button>
              ) : null}
              {payout.status === "PROCESSING" ? (
                <>
                  <button type="button" onClick={() => void act(() => updatePayoutStatus(payout.id, "PAID", "Admin confirmed external payment completion"), "Payout marked paid.")}>Mark paid</button>
                  <button type="button" onClick={() => void act(() => updatePayoutStatus(payout.id, "FAILED", "Admin recorded payout processing failure"), "Payout marked failed and balance released.")}>Fail</button>
                </>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
