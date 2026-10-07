"use client";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  MetricList,
  PageHeader,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import { DataTable } from "@/components/ui/data-presentation";
import {
  getAdminAnalytics,
  getAdminDashboard,
  getAdminSystemHealth,
  searchAdmin,
  type AdminSession,
} from "@/lib/admin-control";
import { getAdminFinanceSummary } from "@/lib/revenue";
import {
  dashboardCounterKeys,
  parseDashboardAnalytics,
  parseDashboardCounters,
  parseDashboardFinance,
  parseDashboardHealth,
  parseDashboardSearch,
} from "@/lib/admin-dashboard";
import { adminDashboardAr, adminDashboardEn } from "@/lib/i18n/resources/admin-dashboard";
import { visibleAdminNavigation } from "@/lib/workspace-navigation";
import { useAdminAccess } from "./admin-access";
import styles from "./admin-dashboard.module.css";
type Snapshot<T> = T | null | undefined;
type SearchState = {
  status: "idle" | "loading" | "error" | "ready";
  items: ReturnType<typeof parseDashboardSearch>;
};
export function AdminDashboard() {
  const { locale } = useI18n();
  const copy = locale === "ar" ? adminDashboardAr : adminDashboardEn;
  const { session, loading, refresh } = useAdminAccess();
  if (session)
    return (
      <AdminDashboardContent
        key={`${session.accountId}:${session.roles.join(":")}`}
        session={session}
      />
    );
  return (
    <>
      <PageHeader
        density="compact"
        title={copy.title}
        eyebrow={copy.eyebrow}
        description={copy.description}
      />
      {loading ? (
        <StatusNotice announce="polite">{copy.loading}</StatusNotice>
      ) : (
        <StatusNotice tone="danger" announce="assertive">
          {copy.accessError} <ActionButton onClick={refresh}>{copy.retryAccess}</ActionButton>
        </StatusNotice>
      )}
    </>
  );
}
function AdminDashboardContent({ session }: { session: AdminSession }) {
  const { locale, t, href, formatNumber, formatDate } = useI18n();
  const copy = locale === "ar" ? adminDashboardAr : adminDashboardEn;
  const [counters, setCounters] = useState<Snapshot<ReturnType<typeof parseDashboardCounters>>>();
  const [analytics, setAnalytics] =
    useState<Snapshot<ReturnType<typeof parseDashboardAnalytics>>>();
  const [health, setHealth] = useState<Snapshot<ReturnType<typeof parseDashboardHealth>>>();
  const [finance, setFinance] = useState<Snapshot<ReturnType<typeof parseDashboardFinance>>>();
  const [observed, setObserved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle", items: [] });
  const read = useRef<AbortController | null>(null),
    searchRead = useRef<AbortController | null>(null);
  const canReadFinance = Boolean(
    session?.roles.some((role) => ["SUPERADMIN", "ADMIN", "FINANCE_MANAGER"].includes(role)),
  );
  const load = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const timeout = setTimeout(() => {
      if (controller.signal.aborted || read.current !== controller) return;
      controller.abort();
      read.current = null;
      setCounters((current) => (current === undefined ? null : current));
      setAnalytics((current) => (current === undefined ? null : current));
      setHealth((current) => (current === undefined ? null : current));
      setFinance((current) => (current === undefined ? null : current));
      setLoading(false);
    }, 15000);
    controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
    const financeAllowed = session.roles.some((role) =>
      ["SUPERADMIN", "ADMIN", "FINANCE_MANAGER"].includes(role),
    );
    // Independent summaries can fail without hiding role-authorized navigation or other data.
    async function summary<T>(
      request: Promise<unknown>,
      parse: (value: unknown) => T,
      set: (value: T | null) => void,
    ) {
      try {
        const value = parse(await request);
        if (!controller.signal.aborted) set(value);
      } catch {
        if (!controller.signal.aborted) set(null);
      }
    }
    await Promise.allSettled([
      summary(getAdminDashboard(controller.signal), parseDashboardCounters, (value) => {
        setCounters(value);
        if (value) setObserved(new Date().toISOString());
      }),
      summary(getAdminAnalytics(controller.signal), parseDashboardAnalytics, setAnalytics),
      summary(getAdminSystemHealth(controller.signal), parseDashboardHealth, setHealth),
      financeAllowed
        ? summary(getAdminFinanceSummary(controller.signal), parseDashboardFinance, setFinance)
        : Promise.resolve(),
    ]);
    clearTimeout(timeout);
    if (!controller.signal.aborted) setLoading(false);
    if (read.current === controller) read.current = null;
  }, [session]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      read.current?.abort();
      searchRead.current?.abort();
    };
  }, [load]);
  function changeQuery(value: string) {
    searchRead.current?.abort();
    searchRead.current = null;
    setQuery(value);
    setSearch({ status: "idle", items: [] });
  }
  async function runSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (!session || normalized.length < 2 || normalized.length > 200 || searchRead.current) return;
    const controller = new AbortController();
    searchRead.current = controller;
    const timeout = setTimeout(() => {
      if (controller.signal.aborted || searchRead.current !== controller) return;
      controller.abort();
      searchRead.current = null;
      setSearch({ status: "error", items: [] });
    }, 15000);
    controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
    setSearch({ status: "loading", items: [] });
    try {
      const items = parseDashboardSearch(
        await searchAdmin(normalized, controller.signal),
        normalized,
      );
      if (!controller.signal.aborted) setSearch({ status: "ready", items });
    } catch {
      if (!controller.signal.aborted) setSearch({ status: "error", items: [] });
    } finally {
      clearTimeout(timeout);
      if (searchRead.current === controller) searchRead.current = null;
    }
  }
  const groups = visibleAdminNavigation(session?.roles ?? []).filter(
    (group) => group.id !== "overview",
  );
  const primary = groups.filter((group) =>
    ["content", "safety", "monetization"].includes(group.id),
  );
  const state = (value: unknown) =>
    value === undefined ? (
      <StatusNotice announce="polite">{copy.loading}</StatusNotice>
    ) : value === null ? (
      <StatusNotice tone="warning" announce="polite">
        {copy.unavailable}
      </StatusNotice>
    ) : null;
  const timestamp = (value: string) =>
    formatDate(value, { dateStyle: "medium", timeStyle: "short" });
  const rate = (value: { retentionRate: number } | null) =>
    value
      ? formatNumber(value.retentionRate, { style: "percent", maximumFractionDigits: 1 })
      : copy.pending;
  return (
    <>
      <PageHeader
        density="compact"
        title={copy.title}
        eyebrow={copy.eyebrow}
        description={copy.description}
        actions={
          session ? (
            <ActionButton
              tone="secondary"
              disabled={loading}
              onClick={() => {
                if (!read.current) {
                  setCounters(undefined);
                  setAnalytics(undefined);
                  setHealth(undefined);
                  setFinance(undefined);
                  setObserved(null);
                  setLoading(true);
                  void load();
                }
              }}
            >
              {copy.refresh}
            </ActionButton>
          ) : undefined
        }
      />
      <>
        <section className={`${styles.panel} ${styles.searchPanel}`} aria-label={copy.search}>
          <PageHeader
            density="compact"
            level={2}
            title={copy.search}
            description={copy.searchHint}
          />
          <form
            className={styles.search}
            onSubmit={runSearch}
            role="search"
            aria-label={copy.search}
          >
            <TextField
              id="admin-global-search"
              label={copy.searchLabel}
              minLength={2}
              maxLength={200}
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
            />
            <ActionButton
              type="submit"
              pending={search.status === "loading"}
              disabled={query.trim().length < 2 || search.status === "loading"}
            >
              {search.status === "loading" ? copy.searching : copy.searchAction}
            </ActionButton>
          </form>
          {search.status === "idle" && <p className={styles.muted}>{copy.searchIdle}</p>}
          {search.status === "error" && (
            <StatusNotice tone="warning" announce="polite">
              {copy.searchError}
            </StatusNotice>
          )}
          {search.status === "ready" &&
            (search.items.length ? (
              <ul className={styles.results} aria-label={copy.searchResults}>
                {search.items.map((result) => (
                  <li key={`${result.kind}:${result.id}`}>
                    <DataBadge>{copy[result.kind]}</DataBadge>
                    <ActionLink tone="quiet" href={href(result.href)}>
                      <span dir="auto">{result.label}</span>
                    </ActionLink>
                    <p dir="auto" className={styles.muted}>
                      {result.detail}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <StatusNotice announce="polite">{copy.searchEmpty}</StatusNotice>
            ))}
        </section>
        <section aria-label={copy.priorities} className={styles.panel}>
          <PageHeader density="compact" level={2} title={copy.priorities} />
          <div className={styles.grid}>
            {primary.map((group) => (
              <article className={styles.workspace} aria-label={t(group.label)} key={group.id}>
                <h3>{t(group.label)}</h3>
                <div className={styles.links}>
                  {group.items.map((item) => (
                    <ActionLink tone="secondary" href={href(item.href)} key={item.href}>
                      {t(item.label)}
                    </ActionLink>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <details className={styles.details}>
            <summary>{copy.tools}</summary>
            <div className={styles.grid}>
              {groups.map((group) => (
                <div key={group.id}>
                  <h3>{t(group.label)}</h3>
                  <div className={styles.links}>
                    {group.items.map((item) => (
                      <ActionLink tone="quiet" href={href(item.href)} key={item.href}>
                        {t(item.label)}
                      </ActionLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>
        <section className={styles.panel} aria-label={copy.counters}>
          <PageHeader density="compact" level={2} title={copy.counters} />
          {state(counters)}
          {counters && (
            <MetricList
              label={copy.counters}
              items={dashboardCounterKeys.map((key) => ({
                label: copy[key],
                value: formatNumber(counters[key]),
              }))}
            />
          )}
          {observed && (
            <p className={styles.muted}>
              {copy.observed}: <time dateTime={observed}>{timestamp(observed)}</time>
            </p>
          )}
        </section>
        <div className={styles.grid}>
          <section className={styles.panel} aria-label={copy.finance}>
            <PageHeader density="compact" level={2} title={copy.finance} />
            {!canReadFinance ? (
              <p className={styles.muted}>{copy.financeHidden}</p>
            ) : (
              <>
                {state(finance)}
                {finance && (
                  <>
                    <MetricList
                      label={copy.finance}
                      items={[
                        {
                          label: copy.pendingPayouts,
                          value: formatNumber(finance.pendingPayouts),
                        },
                        {
                          label: copy.processingPayouts,
                          value: formatNumber(finance.processingPayouts),
                        },
                        { label: copy.openDisputes, value: formatNumber(finance.openDisputes) },
                      ]}
                    />
                    {finance.pendingValue.length > 0 && (
                      <div>
                        <h3>{copy.pendingValue}</h3>
                        {finance.pendingValue.map((item) => (
                          <p key={item.currency} dir="ltr">
                            {item.currency} {item.amount}
                          </p>
                        ))}
                      </div>
                    )}
                    <p>
                      {copy.payoutMode}:{" "}
                      {finance.mode === "MANUAL_PAYOUT" ? copy.manual : copy.providerManual}
                    </p>
                    <p>
                      {copy.providerConfigured}:{" "}
                      {finance.externalProvider.connected ? copy.yes : copy.no}
                    </p>
                    <p>
                      {copy.productionEnabled}:{" "}
                      {finance.externalProvider.productionEnabled ? copy.yes : copy.no}
                    </p>
                    <ActionLink href={href("/admin/revenue")}>{t("navigation.revenue")}</ActionLink>
                  </>
                )}
              </>
            )}
          </section>
          <section className={styles.panel} aria-label={copy.health}>
            <PageHeader density="compact" level={2} title={copy.health} />
            {state(health)}
            {health && (
              <>
                <MetricList
                  label={copy.health}
                  items={[
                    { label: copy.api, value: copy[health.api] },
                    { label: copy.database, value: copy[health.database] },
                    { label: copy.storage, value: copy[health.storage] },
                  ]}
                />
                <p className={styles.muted}>
                  {copy.checked}:{" "}
                  <time dateTime={health.checkedAt}>{timestamp(health.checkedAt)}</time>
                </p>
                <details className={styles.details}>
                  <summary>
                    {copy.queues} / {copy.workers}
                  </summary>
                  <p>
                    {copy.storageMode}: {health.storageMode}
                  </p>
                  <p>
                    {copy.queues}: {copy[health.queues.status]}
                  </p>
                  <p dir="auto">{health.queues.reason}</p>
                  <p>
                    {copy.workers}: {copy[health.workers.status]}
                  </p>
                  <p dir="auto">{health.workers.reason}</p>
                </details>
              </>
            )}
          </section>
        </div>
        <section className={styles.panel} aria-label={copy.analytics}>
          <PageHeader
            density="compact"
            level={2}
            title={copy.analytics}
            description={copy.rollup}
          />
          {state(analytics)}
          {analytics && (
            <>
              <MetricList
                label={copy.analytics}
                items={(
                  ["dau", "mau", "watchHours", "uploads", "tvStarts", "adEvents", "errors"] as const
                ).map((key, index) => ({
                  label: copy[key],
                  value: formatNumber(
                    [
                      analytics.dauApprox,
                      analytics.mauApprox,
                      analytics.watchHours,
                      analytics.uploads,
                      analytics.tvStarts,
                      analytics.adEvents,
                      analytics.errors,
                    ][index]!,
                    { maximumFractionDigits: key === "watchHours" ? 1 : 0 },
                  ),
                }))}
              />
              <p className={styles.muted}>
                {copy.range}:{" "}
                {formatDate(analytics.dateRange.from, { dateStyle: "medium", timeZone: "UTC" })} —{" "}
                {formatDate(analytics.dateRange.to, { dateStyle: "medium", timeZone: "UTC" })}
              </p>
              <p className={styles.muted}>
                {copy.lastRollup}:{" "}
                {analytics.lastRollupCheck ? timestamp(analytics.lastRollupCheck) : copy.pending}
              </p>
              <details className={styles.details}>
                <summary>{copy.cohorts}</summary>
                <p>{copy.cohortPrivacy}</p>
                <p>
                  {copy.minimum}: {formatNumber(analytics.cohorts.minimumCohortSize)}
                </p>
                {analytics.cohorts.retention.length ? (
                  <DataTable
                    caption={copy.retention}
                    rows={analytics.cohorts.retention.slice(-10)}
                    rowKey={(row) => row.cohortDate}
                    columns={[
                      {
                        key: "date",
                        heading: copy.date,
                        rowHeader: true,
                        render: (row) =>
                          formatDate(row.cohortDate, { dateStyle: "medium", timeZone: "UTC" }),
                      },
                      {
                        key: "profiles",
                        heading: copy.profiles,
                        render: (row) => formatNumber(row.cohortSize),
                      },
                      ...(["d1", "d7", "d30"] as const).map((key) => ({
                        key: key,
                        heading: key.toUpperCase(),
                        render: (
                          row: ReturnType<
                            typeof parseDashboardAnalytics
                          >["cohorts"]["retention"][number],
                        ) => rate(row[key]),
                      })),
                    ]}
                  />
                ) : (
                  <p>{copy.cohortEmpty}</p>
                )}
                {analytics.cohorts.audienceDaily.length ? (
                  <DataTable
                    caption={copy.recentAudience}
                    rows={analytics.cohorts.audienceDaily.slice(-7)}
                    rowKey={(row) => row.date}
                    columns={[
                      {
                        key: "date",
                        heading: copy.date,
                        rowHeader: true,
                        render: (row) =>
                          formatDate(row.date, { dateStyle: "medium", timeZone: "UTC" }),
                      },
                      {
                        key: "new",
                        heading: copy.newProfiles,
                        render: (row) => formatNumber(row.newProfiles),
                      },
                      {
                        key: "returning",
                        heading: copy.returningProfiles,
                        render: (row) => formatNumber(row.returningProfiles),
                      },
                      {
                        key: "sessions",
                        heading: copy.sessions,
                        render: (row) =>
                          formatNumber(row.sessionsPerActiveProfile, {
                            maximumFractionDigits: 2,
                          }),
                      },
                    ]}
                  />
                ) : (
                  <p>{copy.audienceEmpty}</p>
                )}
              </details>
            </>
          )}
        </section>
      </>
    </>
  );
}
