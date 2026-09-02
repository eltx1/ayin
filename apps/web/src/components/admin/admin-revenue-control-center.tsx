"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  searchAdminRevenueChannels,
  type AdminRevenueChannelTarget,
} from "@/lib/admin-operations-directory";
import {
  createAdminPayout,
  getAdminChannelContracts,
  importAdminRevenue,
  type AdminChannelContract,
} from "@/lib/admin-revenue-operations";
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

type RevenueImportDraft = {
  source: string;
  state: "ESTIMATED" | "FINAL";
  periodStart: string;
  periodEnd: string;
  grossAmount: string;
  currency: string;
  adSource: string;
  memo: string;
  idempotencyKey: string;
};

function newImportKey() {
  return `admin-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const emptyImport = (): RevenueImportDraft => ({
  source: "MANUAL_ADMIN_IMPORT",
  state: "FINAL",
  periodStart: "",
  periodEnd: "",
  grossAmount: "",
  currency: "USD",
  adSource: "",
  memo: "",
  idempotencyKey: newImportKey(),
});

function payoutActionFor(actions: Record<string, PayoutAction>, id: string): PayoutAction {
  return actions[id] ?? { reason: "", externalReference: "", failureReason: "" };
}

function disputeActionFor(actions: Record<string, DisputeAction>, id: string): DisputeAction {
  return actions[id] ?? { reason: "", resolution: "" };
}

function toIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function AdminRevenueControlCenter() {
  const [settings, setSettings] = useState<AdminRevenueSettings | null>(null);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [payouts, setPayouts] = useState<PayoutData | null>(null);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [disputes, setDisputes] = useState<AdminRevenueDispute[]>([]);
  const [contracts, setContracts] = useState<AdminChannelContract[]>([]);
  const [defaultShareBps, setDefaultShareBps] = useState<number | null>(null);

  const [channelQuery, setChannelQuery] = useState("");
  const [channelMatches, setChannelMatches] = useState<AdminRevenueChannelTarget[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<AdminRevenueChannelTarget | null>(null);

  const [shareBps, setShareBps] = useState("5500");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reason, setReason] = useState("");
  const [importDraft, setImportDraft] = useState<RevenueImportDraft>(() => emptyImport());

  const [ledgerChannelId, setLedgerChannelId] = useState("");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [payoutPage, setPayoutPage] = useState(1);
  const [payoutStatus, setPayoutStatus] = useState("");
  const [disputeStatus, setDisputeStatus] = useState("");
  const [payoutActions, setPayoutActions] = useState<Record<string, PayoutAction>>({});
  const [disputeActions, setDisputeActions] = useState<Record<string, DisputeAction>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const ledgerParams = new URLSearchParams({ page: String(ledgerPage), take: "25" });
      if (ledgerChannelId) ledgerParams.set("channelId", ledgerChannelId);
      const payoutParams = new URLSearchParams({ page: String(payoutPage), take: "25" });
      if (payoutStatus) payoutParams.set("status", payoutStatus);
      const [nextSettings, nextLedger, nextPayouts, nextFinance, nextDisputes] = await Promise.all([
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
  }, [disputeStatus, ledgerChannelId, ledgerPage, payoutPage, payoutStatus]);

  const loadContracts = useCallback(async (channelId: string) => {
    const data = await getAdminChannelContracts(channelId);
    setContracts(data.contracts);
    setDefaultShareBps(data.defaultRevenueShareBps);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
      if (selectedChannel) await loadContracts(selectedChannel.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Revenue change was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function searchChannels() {
    if (channelQuery.trim().length < 2) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await searchAdminRevenueChannels(channelQuery);
      setChannelMatches(result.items);
      if (!result.items.length) setMessage("No matching creator channels.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Channel search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function selectChannel(channel: AdminRevenueChannelTarget) {
    setSelectedChannel(channel);
    setCurrency(channel.payoutProfile?.preferredCurrency ?? "USD");
    setChannelMatches([]);
    setChannelQuery(`${channel.name} (@${channel.handle})`);
    setBusy(true);
    setMessage("");
    try {
      await loadContracts(channel.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Channel contracts could not be loaded.");
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

  const selectedLabel = selectedChannel
    ? `${selectedChannel.name} (@${selectedChannel.handle})`
    : "No creator channel selected";
  const ledgerPages = ledger?.pagination.pages ?? 1;
  const payoutPagination = payouts?.pagination;
  const payoutPages = payoutPagination?.pages ?? 1;
  const pendingValue = useMemo(
    () => finance?.pendingValue.map((item) => `${item.currency} ${item.amount}`).join(" · ") || "—",
    [finance],
  );

  async function submitImport() {
    if (!selectedChannel) return;
    const periodStart = toIso(importDraft.periodStart);
    const periodEnd = toIso(importDraft.periodEnd);
    if (!periodStart || !periodEnd) {
      setMessage("Choose a valid revenue period start and end.");
      return;
    }
    await act(
      async () => {
        const result = await importAdminRevenue({
          source: importDraft.source.trim(),
          entries: [
            {
              idempotencyKey: importDraft.idempotencyKey,
              channelId: selectedChannel.id,
              periodStart,
              periodEnd,
              grossAmount: importDraft.grossAmount.trim(),
              currency: importDraft.currency.trim().toUpperCase(),
              state: importDraft.state,
              adSource: importDraft.adSource.trim() || null,
              memo: importDraft.memo.trim() || null,
            },
          ],
        });
        if (result.created === 1) setImportDraft(emptyImport());
      },
      "Revenue import processed with idempotency protection.",
    );
  }

  return (
    <div className={styles.grid}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>AYIN Monetization</span>
          <h1>Revenue Control Center</h1>
          <p className={styles.muted}>
            Full finance operations for creator contracts, imports, append-only ledger adjustments,
            payouts and revenue disputes. Creator selection is name-based; internal UUIDs stay hidden.
          </p>
        </div>
        <span className={styles.statusPill}>Manual payout V1</span>
      </header>

      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}

      {finance ? (
        <section className={styles.metrics} aria-label="Revenue operations summary">
          <article className={styles.metric}>
            <span className={styles.muted}>Pending payouts</span>
            <strong>{finance.pendingPayouts}</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Processing</span>
            <strong>{finance.processingPayouts}</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Open disputes</span>
            <strong>{finance.openDisputes}</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Pending value</span>
            <strong>{pendingValue}</strong>
          </article>
        </section>
      ) : null}

      <section className={styles.card}>
        <h2>Creator channel</h2>
        <p className={styles.muted}>
          Search once and use the selected creator across contracts, adjustments, imports and payouts.
        </p>
        <div className={styles.toolbar}>
          <input
            minLength={2}
            placeholder="Search creator channel name or @handle"
            value={channelQuery}
            onChange={(event) => setChannelQuery(event.target.value)}
          />
          <button
            className={styles.button}
            disabled={busy || channelQuery.trim().length < 2}
            type="button"
            onClick={() => void searchChannels()}
          >
            Search
          </button>
          {selectedChannel ? (
            <button
              className={styles.button}
              type="button"
              onClick={() => {
                setSelectedChannel(null);
                setChannelQuery("");
                setContracts([]);
                setDefaultShareBps(null);
              }}
            >
              Clear selection
            </button>
          ) : null}
        </div>
        {channelMatches.length ? (
          <div className={styles.commandGrid}>
            {channelMatches.map((channel) => (
              <button
                className={styles.button}
                key={channel.id}
                type="button"
                onClick={() => void selectChannel(channel)}
              >
                {channel.name} · @{channel.handle} · {channel.status}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.cardInset}>
          <strong>{selectedLabel}</strong>
          {selectedChannel ? (
            <p className={styles.muted}>
              Identity {selectedChannel.payoutProfile?.identityStatus ?? "NOT_STARTED"} · Tax {" "}
              {selectedChannel.payoutProfile?.taxStatus ?? "NOT_PROVIDED"} · Preferred currency {" "}
              {selectedChannel.payoutProfile?.preferredCurrency ?? "not set"}
            </p>
          ) : (
            <p className={styles.muted}>Select a creator before running channel-specific finance actions.</p>
          )}
        </div>
      </section>

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
            <button className={styles.button} disabled={busy} type="submit">
              Save defaults
            </button>
          </form>
        ) : null}
      </section>

      <div className={styles.commandGrid}>
        <section className={styles.card}>
          <h2>Per-channel contract</h2>
          <p className={styles.muted}>
            Current admin default: {defaultShareBps === null ? "—" : `${defaultShareBps} bps`}.
          </p>
          <form
            className={styles.grid}
            onSubmit={(event) => {
              event.preventDefault();
              if (!selectedChannel) return;
              void act(
                () =>
                  createChannelContract(selectedChannel.id, {
                    revenueShareBps: Number(shareBps),
                    effectiveFrom: new Date().toISOString(),
                    termsVersion: "admin-v1",
                  }),
                "Channel contract override created.",
              );
            }}
          >
            <input
              aria-label="Revenue share basis points"
              type="number"
              min="0"
              max="10000"
              value={shareBps}
              onChange={(event) => setShareBps(event.target.value)}
            />
            <button className={styles.button} disabled={busy || !selectedChannel} type="submit">
              Create effective override
            </button>
          </form>
          <div className={styles.grid}>
            {contracts.map((contract) => (
              <article className={styles.cardInset} key={contract.id}>
                <strong>{contract.revenueShareBps} bps</strong> · {contract.status}
                <p className={styles.muted}>
                  From {new Date(contract.effectiveFrom).toLocaleString()}
                  {contract.effectiveTo
                    ? ` · until ${new Date(contract.effectiveTo).toLocaleString()}`
                    : " · open-ended"}
                  {contract.termsVersion ? ` · ${contract.termsVersion}` : ""}
                </p>
              </article>
            ))}
            {selectedChannel && contracts.length === 0 ? (
              <p className={styles.muted}>No channel-specific contracts; global default applies.</p>
            ) : null}
          </div>
        </section>

        <section className={styles.card}>
          <h2>Manual adjustment</h2>
          <p className={styles.muted}>Append-only: historical earnings are never rewritten.</p>
          <form
            className={styles.grid}
            onSubmit={(event) => {
              event.preventDefault();
              if (!selectedChannel || !amount || reason.trim().length < 8) return;
              void act(
                () =>
                  addRevenueAdjustment({
                    channelId: selectedChannel.id,
                    amount,
                    currency,
                    reason,
                  }),
                "Adjustment appended and audited.",
              );
            }}
          >
            <input
              aria-label="Adjustment amount"
              placeholder="10.000000 or -10.000000"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <input
              aria-label="Currency"
              maxLength={3}
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
            <textarea
              aria-label="Adjustment reason"
              minLength={8}
              placeholder="Mandatory operator reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <button
              className={styles.button}
              disabled={busy || !selectedChannel || reason.trim().length < 8}
              type="submit"
            >
              Append adjustment
            </button>
          </form>
        </section>

        <section className={styles.card}>
          <h2>Admin-created payout</h2>
          <p className={styles.muted}>
            Creates an auditable manual payout from finalized eligible balance.
          </p>
          <label>
            Currency
            <input
              maxLength={3}
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </label>
          <button
            className={styles.button}
            type="button"
            disabled={!selectedChannel || busy}
            onClick={() =>
              selectedChannel
                ? void act(
                    () => createAdminPayout(selectedChannel.id, currency),
                    "Payout record created from finalized balance.",
                  )
                : undefined
            }
          >
            Create payout for selected creator
          </button>
        </section>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Revenue import</h2>
            <p className={styles.muted}>
              Import estimated or finalized gross revenue with idempotency protection. AYIN applies
              the effective creator contract and writes the creator share to the append-only ledger.
            </p>
          </div>
          <span className={styles.statusPill}>{importDraft.state}</span>
        </div>
        <div className={styles.formGrid}>
          <label>
            Import source
            <input
              value={importDraft.source}
              onChange={(event) => setImportDraft({ ...importDraft, source: event.target.value })}
            />
          </label>
          <label>
            State
            <select
              value={importDraft.state}
              onChange={(event) =>
                setImportDraft({
                  ...importDraft,
                  state: event.target.value as RevenueImportDraft["state"],
                })
              }
            >
              <option value="ESTIMATED">Estimated</option>
              <option value="FINAL">Final</option>
            </select>
          </label>
          <label>
            Period start
            <input
              type="datetime-local"
              value={importDraft.periodStart}
              onChange={(event) => setImportDraft({ ...importDraft, periodStart: event.target.value })}
            />
          </label>
          <label>
            Period end
            <input
              type="datetime-local"
              value={importDraft.periodEnd}
              onChange={(event) => setImportDraft({ ...importDraft, periodEnd: event.target.value })}
            />
          </label>
          <label>
            Gross amount
            <input
              placeholder="100.000000"
              value={importDraft.grossAmount}
              onChange={(event) => setImportDraft({ ...importDraft, grossAmount: event.target.value })}
            />
          </label>
          <label>
            Currency
            <input
              maxLength={3}
              value={importDraft.currency}
              onChange={(event) =>
                setImportDraft({ ...importDraft, currency: event.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Ad source
            <input
              placeholder="Optional SSP / GAM / direct source"
              value={importDraft.adSource}
              onChange={(event) => setImportDraft({ ...importDraft, adSource: event.target.value })}
            />
          </label>
          <label>
            Idempotency key
            <input
              value={importDraft.idempotencyKey}
              onChange={(event) =>
                setImportDraft({ ...importDraft, idempotencyKey: event.target.value })
              }
            />
          </label>
          <label className={styles.fullField}>
            Memo
            <textarea
              value={importDraft.memo}
              onChange={(event) => setImportDraft({ ...importDraft, memo: event.target.value })}
            />
          </label>
        </div>
        <button
          className={styles.button}
          disabled={
            busy ||
            !selectedChannel ||
            !importDraft.source.trim() ||
            importDraft.idempotencyKey.trim().length < 8 ||
            !importDraft.grossAmount.trim() ||
            !importDraft.periodStart ||
            !importDraft.periodEnd
          }
          type="button"
          onClick={() => void submitImport()}
        >
          Import revenue for selected creator
        </button>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Payout operations</h2>
            <p className={styles.muted}>
              Status transitions require an operator reason and retain external payment references.
            </p>
          </div>
          <select
            aria-label="Payout status filter"
            value={payoutStatus}
            onChange={(event) => {
              setPayoutStatus(event.target.value);
              setPayoutPage(1);
            }}
          >
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
            const mutable = payout.status === "PENDING" || payout.status === "PROCESSING";
            return (
              <article className={styles.cardInset} key={payout.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <strong>{payout.channel.name}</strong> · @{payout.channel.handle}
                    <p>
                      {payout.currency} {payout.amount} · {payout.status}
                    </p>
                    <p className={styles.muted}>
                      Requested {new Date(payout.requestedAt).toLocaleString()}
                    </p>
                  </div>
                  {payout.externalReference ? (
                    <span className={styles.muted}>Ref: {payout.externalReference}</span>
                  ) : null}
                </div>
                {mutable ? (
                  <div className={styles.grid}>
                    <textarea
                      minLength={8}
                      placeholder="Mandatory operator reason"
                      value={action.reason}
                      onChange={(event) => setPayoutField(payout.id, "reason", event.target.value)}
                    />
                    {payout.status === "PROCESSING" ? (
                      <>
                        <input
                          placeholder="External payment reference"
                          value={action.externalReference}
                          onChange={(event) =>
                            setPayoutField(payout.id, "externalReference", event.target.value)
                          }
                        />
                        <input
                          placeholder="Failure reason"
                          value={action.failureReason}
                          onChange={(event) =>
                            setPayoutField(payout.id, "failureReason", event.target.value)
                          }
                        />
                      </>
                    ) : null}
                    <div className={styles.actions}>
                      {payout.status === "PENDING" ? (
                        <>
                          <button
                            className={styles.button}
                            disabled={busy || action.reason.trim().length < 8}
                            type="button"
                            onClick={() =>
                              void act(
                                () => updatePayoutStatus(payout.id, "PROCESSING", action.reason),
                                "Payout moved to processing.",
                              )
                            }
                          >
                            Start processing
                          </button>
                          <button
                            className={styles.danger}
                            disabled={busy || action.reason.trim().length < 8}
                            type="button"
                            onClick={() =>
                              void act(
                                () => updatePayoutStatus(payout.id, "CANCELLED", action.reason),
                                "Payout cancelled.",
                              )
                            }
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className={styles.button}
                            disabled={busy || action.reason.trim().length < 8}
                            type="button"
                            onClick={() =>
                              void act(
                                () =>
                                  updatePayoutStatus(payout.id, "PAID", action.reason, {
                                    externalReference: action.externalReference || null,
                                  }),
                                "Payout marked paid.",
                              )
                            }
                          >
                            Mark paid
                          </button>
                          <button
                            className={styles.danger}
                            disabled={
                              busy ||
                              action.reason.trim().length < 8 ||
                              action.failureReason.trim().length < 3
                            }
                            type="button"
                            onClick={() =>
                              void act(
                                () =>
                                  updatePayoutStatus(payout.id, "FAILED", action.reason, {
                                    failureReason: action.failureReason,
                                  }),
                                "Payout marked failed.",
                              )
                            }
                          >
                            Fail payout
                          </button>
                          <button
                            className={styles.danger}
                            disabled={busy || action.reason.trim().length < 8}
                            type="button"
                            onClick={() =>
                              void act(
                                () => updatePayoutStatus(payout.id, "CANCELLED", action.reason),
                                "Payout cancelled.",
                              )
                            }
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
                {payout.failureReason ? (
                  <p className={styles.error}>Failure: {payout.failureReason}</p>
                ) : null}
              </article>
            );
          })}
          {payouts && payouts.items.length === 0 ? (
            <p className={styles.muted}>No payouts match this filter.</p>
          ) : null}
        </div>
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={payoutPage <= 1}
            type="button"
            onClick={() => setPayoutPage((page) => Math.max(1, page - 1))}
          >
            Previous payouts
          </button>
          <span className={styles.muted}>
            Page {payoutPage} of {payoutPages}
          </span>
          <button
            className={styles.button}
            disabled={payoutPage >= payoutPages}
            type="button"
            onClick={() => setPayoutPage((page) => page + 1)}
          >
            Next payouts
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Creator revenue disputes</h2>
            <p className={styles.muted}>Review earnings and payout cases with an auditable resolution.</p>
          </div>
          <select
            aria-label="Revenue dispute status"
            value={disputeStatus}
            onChange={(event) => setDisputeStatus(event.target.value)}
          >
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
              <article className={styles.cardInset} key={dispute.id}>
                <strong>{dispute.channelName}</strong> · @{dispute.channelHandle}
                <p>
                  {dispute.category} · {dispute.status}
                </p>
                <p className={styles.muted}>{dispute.creatorEmail}</p>
                <p>{dispute.message}</p>
                {dispute.resolution ? (
                  <p>
                    <strong>Resolution:</strong> {dispute.resolution}
                  </p>
                ) : null}
                {active ? (
                  <div className={styles.grid}>
                    <textarea
                      minLength={8}
                      placeholder="Resolution / review note"
                      value={action.resolution}
                      onChange={(event) =>
                        setDisputeField(dispute.id, "resolution", event.target.value)
                      }
                    />
                    <input
                      minLength={8}
                      placeholder="Mandatory audit reason"
                      value={action.reason}
                      onChange={(event) => setDisputeField(dispute.id, "reason", event.target.value)}
                    />
                    <div className={styles.actions}>
                      {dispute.status === "OPEN" ? (
                        <button
                          className={styles.button}
                          disabled={busy || action.reason.trim().length < 8}
                          type="button"
                          onClick={() =>
                            void act(
                              () =>
                                updateAdminRevenueDispute(dispute.id, {
                                  status: "REVIEWING",
                                  resolution: action.resolution || null,
                                  reason: action.reason,
                                }),
                              "Dispute moved to review.",
                            )
                          }
                        >
                          Start review
                        </button>
                      ) : null}
                      <button
                        className={styles.button}
                        disabled={
                          busy ||
                          action.reason.trim().length < 8 ||
                          action.resolution.trim().length < 8
                        }
                        type="button"
                        onClick={() =>
                          void act(
                            () =>
                              updateAdminRevenueDispute(dispute.id, {
                                status: "RESOLVED",
                                resolution: action.resolution,
                                reason: action.reason,
                              }),
                            "Dispute resolved.",
                          )
                        }
                      >
                        Resolve
                      </button>
                      <button
                        className={styles.danger}
                        disabled={
                          busy ||
                          action.reason.trim().length < 8 ||
                          action.resolution.trim().length < 8
                        }
                        type="button"
                        onClick={() =>
                          void act(
                            () =>
                              updateAdminRevenueDispute(dispute.id, {
                                status: "REJECTED",
                                resolution: action.resolution,
                                reason: action.reason,
                              }),
                            "Dispute closed as rejected.",
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
          {disputes.length === 0 ? (
            <p className={styles.muted}>No disputes match this filter.</p>
          ) : null}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Ledger search</h2>
            <p className={styles.muted}>
              Trace append-only revenue activity platform-wide or for the selected creator.
            </p>
          </div>
          <span className={styles.statusPill}>{ledger?.pagination.total ?? 0} entries</span>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={!selectedChannel}
            type="button"
            onClick={() => {
              if (!selectedChannel) return;
              setLedgerChannelId(selectedChannel.id);
              setLedgerPage(1);
            }}
          >
            Filter to selected creator
          </button>
          <button
            className={styles.button}
            disabled={!ledgerChannelId}
            type="button"
            onClick={() => {
              setLedgerChannelId("");
              setLedgerPage(1);
            }}
          >
            Show all creators
          </button>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>State</th>
                <th>Amount</th>
                <th>Attribution</th>
                <th>Occurred</th>
              </tr>
            </thead>
            <tbody>
              {ledger?.items.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {entry.channel.name} · @{entry.channel.handle}
                  </td>
                  <td>{entry.state}</td>
                  <td>
                    {entry.currency} {entry.amount}
                  </td>
                  <td>
                    {entry.video?.title ??
                      entry.campaign?.name ??
                      entry.adSource ??
                      entry.memo ??
                      entry.type}
                  </td>
                  <td>{new Date(entry.occurredAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ledger && ledger.items.length === 0 ? (
          <p className={styles.muted}>No matching ledger entries.</p>
        ) : null}
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={ledgerPage <= 1}
            type="button"
            onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}
          >
            Previous ledger page
          </button>
          <span className={styles.muted}>
            Page {ledgerPage} of {ledgerPages}
          </span>
          <button
            className={styles.button}
            disabled={ledgerPage >= ledgerPages}
            type="button"
            onClick={() => setLedgerPage((page) => page + 1)}
          >
            Next ledger page
          </button>
        </div>
      </section>
    </div>
  );
}
