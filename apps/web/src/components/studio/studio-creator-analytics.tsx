"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  DataTable,
  Disclosure,
  PageControls,
  type TableColumn,
} from "@/components/ui/data-presentation";
import {
  ActionButton,
  MetricList,
  PageHeader,
  SelectField,
  StatusNotice,
} from "@/components/ui/design-system";
import { EditorTabs } from "@/components/ui/editor-tabs";
import { analyticsAr, analyticsEn } from "@/lib/i18n/resources/studio-analytics";
import { getStudioAnalytics } from "@/lib/studio";
import type { CreatorAnalytics } from "@/lib/studio-analytics";
import styles from "./studio-creator-analytics.module.css";

type Copy = typeof analyticsEn;
type Cohort = CreatorAnalytics["cohorts"]["retention"][number];
type Milestone = NonNullable<Cohort["d1"]>;
function useReportFormat() {
  const { locale, formatNumber, formatDate } = useI18n();
  const copy = locale === "ar" ? analyticsAr : analyticsEn;
  return {
    copy,
    number: (value: number) => formatNumber(value, { maximumFractionDigits: 2 }),
    percent: (value: number) => formatNumber(value, { style: "percent", maximumFractionDigits: 1 }),
    date: (value: string | number) =>
      formatDate(value, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }),
    duration: (value: number) => {
      const seconds = Math.round(value / 1000),
        minutes = Math.floor(seconds / 60);
      return minutes
        ? `${formatNumber(minutes)} ${copy.minutes} ${formatNumber(seconds % 60)} ${copy.seconds}`
        : `${formatNumber(seconds)} ${copy.seconds}`;
    },
  };
}
function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className={styles.facts}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
// The API already bounds the report to at most 365 daily rows. These controls
// page that complete response locally; they do not imply database pagination.
function PagedTable<Row>({
  caption,
  rows,
  columns,
  rowKey,
}: {
  caption: string;
  rows: readonly Row[];
  columns: readonly TableColumn<Row>[];
  rowKey: (row: Row) => string;
}) {
  const { copy, number } = useReportFormat();
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    current = Math.min(page, pages);
  const start = (current - 1) * 20;
  return (
    <>
      <DataTable
        caption={caption}
        rows={rows.slice(start, start + 20)}
        columns={columns}
        rowKey={rowKey}
      />
      {rows.length > 20 && (
        <PageControls
          label={caption}
          summary={`${copy.rows}: ${number(start + 1)}–${number(Math.min(start + 20, rows.length))} ${copy.of} ${number(rows.length)}`}
          previousLabel={copy.previous}
          nextLabel={copy.next}
          hasPrevious={current > 1}
          hasNext={current < pages}
          onPrevious={() => setPage(current - 1)}
          onNext={() => setPage(current + 1)}
        />
      )}
    </>
  );
}
function BreakdownPanel({
  title,
  breakdown,
}: {
  title: string;
  breakdown: CreatorAnalytics["devices"];
}) {
  const { copy, number, percent } = useReportFormat();
  return (
    <section>
      <h2>{title}</h2>
      {breakdown.available ? (
        <>
          <p>
            {copy.coverage}: {percent(breakdown.coverage)}
          </p>
          <DataTable
            caption={title}
            rows={breakdown.items}
            rowKey={(row) => row.value}
            columns={[
              {
                key: "category",
                heading: copy.dimension,
                rowHeader: true,
                render: (row) => <span dir="auto">{row.value}</span>,
              },
              { key: "count", heading: copy.count, render: (row) => number(row.count) },
            ]}
          />
        </>
      ) : (
        <StatusNotice>{copy.noDimension}</StatusNotice>
      )}
    </section>
  );
}
function MilestoneDetails({ milestone }: { milestone: Milestone }) {
  const { copy, number, percent, duration } = useReportFormat();
  return (
    <Facts
      items={[
        [copy.retained, number(milestone.retainedProfiles)],
        [copy.retentionRate, percent(milestone.retentionRate)],
        [copy.sessions, number(milestone.sessions)],
        [copy.sessionsPerRetained, number(milestone.sessionsPerRetainedProfile)],
        [copy.watchTime, duration(milestone.watchTimeMs)],
        [copy.averageWatch, duration(milestone.averageWatchTimeMsPerRetainedProfile)],
        ...(milestone.contentReturnProfiles === undefined
          ? []
          : [
              [
                copy.contentReturn,
                `${number(milestone.contentReturnProfiles)} (${percent(milestone.contentReturnRate!)})`,
              ] as [string, ReactNode],
            ]),
      ]}
    />
  );
}
function CohortPanel({ title, rows }: { title: string; rows: Cohort[] }) {
  const { copy, number, percent, date } = useReportFormat();
  return (
    <section>
      <h2>{title}</h2>
      {rows.length ? (
        <PagedTable
          caption={title}
          rows={rows}
          rowKey={(row) => row.cohortDate}
          columns={[
            {
              key: "date",
              heading: copy.date,
              rowHeader: true,
              render: (row) => date(row.cohortDate),
            },
            { key: "size", heading: copy.size, render: (row) => number(row.cohortSize) },
            ...(["d1", "d7", "d30"] as const).map((key) => ({
              key,
              heading: key.toUpperCase(),
              render: (row: Cohort) => (row[key] ? percent(row[key].retentionRate) : copy.pending),
            })),
            {
              key: "details",
              heading: copy.milestone,
              render: (row) => (
                <Disclosure summary={copy.milestone}>
                  {(["d1", "d7", "d30"] as const).map((key) => (
                    <section key={key}>
                      <h3>{key.toUpperCase()}</h3>
                      {row[key] ? <MilestoneDetails milestone={row[key]} /> : <p>{copy.pending}</p>}
                    </section>
                  ))}
                </Disclosure>
              ),
            },
          ]}
        />
      ) : (
        <StatusNotice>{copy.noCohorts}</StatusNotice>
      )}
    </section>
  );
}
function AudienceDaily({ data }: { data: CreatorAnalytics }) {
  const { copy, number, percent, date, duration } = useReportFormat();
  return (
    <section>
      <h2>{copy.daily}</h2>
      {data.cohorts.audienceDaily.length ? (
        <PagedTable
          caption={copy.daily}
          rows={data.cohorts.audienceDaily}
          rowKey={(row) => row.date}
          columns={[
            { key: "date", heading: copy.date, rowHeader: true, render: (row) => date(row.date) },
            { key: "active", heading: copy.active, render: (row) => number(row.activeProfiles) },
            { key: "new", heading: copy.new, render: (row) => number(row.newProfiles) },
            {
              key: "returning",
              heading: copy.returning,
              render: (row) => `${number(row.returningProfiles)} (${percent(row.returningRate)})`,
            },
            {
              key: "details",
              heading: copy.dataQuality,
              render: (row) => (
                <Disclosure summary={copy.dataQuality}>
                  <Facts
                    items={[
                      [copy.sessions, number(row.sessions)],
                      [copy.sessionsPerProfile, number(row.sessionsPerActiveProfile)],
                      [copy.watchTime, duration(row.watchTimeMs)],
                      [
                        copy.contentReturn,
                        `${number(row.contentReturnProfiles)} (${percent(row.contentReturnRate)})`,
                      ],
                    ]}
                  />
                </Disclosure>
              ),
            },
          ]}
        />
      ) : (
        <StatusNotice>{copy.noCohorts}</StatusNotice>
      )}
    </section>
  );
}
function Privacy({ data, copy }: { data: CreatorAnalytics; copy: Copy }) {
  const { number } = useReportFormat();
  return (
    <StatusNotice>
      {copy.privacy} {copy.minCohort}: {number(data.cohorts.minimumCohortSize)}.
    </StatusNotice>
  );
}
function AnalyticsReport({
  data,
  tab,
  onTab,
}: {
  data: CreatorAnalytics;
  tab: string;
  onTab: (value: string) => void;
}) {
  const { direction, formatDate } = useI18n();
  const { copy, number, percent, date, duration } = useReportFormat();
  const playback = data.playbackQuality;
  const metrics = (label: string, items: Array<[string, string]>) => (
    <MetricList label={label} items={items.map(([label, value]) => ({ label, value }))} />
  );
  return (
    <div className={styles.report}>
      <p>
        {copy.range}: {date(data.dateRange.from)} – {date(Date.parse(data.dateRange.to) - 1)} (UTC)
      </p>
      <p className={styles.updated}>
        {copy.updated}:{" "}
        {data.lastRollupCheck
          ? formatDate(data.lastRollupCheck, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "UTC",
            }) + " (UTC)"
          : copy.unavailable}
      </p>
      <EditorTabs
        label={copy.sections}
        value={tab}
        onChange={onTab}
        direction={direction}
        tabs={[
          {
            id: "overview",
            label: copy.overview,
            content: (
              <div className={styles.section}>
                {metrics(copy.overview, [
                  [copy.views, number(data.views)],
                  [copy.unique, number(data.uniqueViewersApprox)],
                  [copy.watchTime, duration(data.watchTimeMs)],
                  [copy.averageView, duration(data.averageViewDurationMs)],
                  [copy.completion, percent(data.completionRate)],
                  [copy.gained, number(data.subscribersGained)],
                ])}
                <section>
                  <h2>{copy.dataQuality}</h2>
                  <p>{copy.method}</p>
                </section>
              </div>
            ),
          },
          {
            id: "content",
            label: copy.content,
            content: (
              <section className={styles.section}>
                <h2>{copy.top}</h2>
                {data.topVideos.length ? (
                  <DataTable
                    caption={copy.top}
                    rows={data.topVideos}
                    rowKey={(row) => row.videoId}
                    columns={[
                      {
                        key: "title",
                        heading: copy.video,
                        rowHeader: true,
                        render: (row) => <span dir="auto">{row.title}</span>,
                      },
                      { key: "views", heading: copy.views, render: (row) => number(row.views) },
                    ]}
                  />
                ) : (
                  <StatusNotice>{copy.noVideos}</StatusNotice>
                )}
              </section>
            ),
          },
          {
            id: "audience",
            label: copy.audience,
            content: (
              <div className={styles.section}>
                <BreakdownPanel title={copy.traffic} breakdown={data.trafficSources} />
                <BreakdownPanel title={copy.devices} breakdown={data.devices} />
                <BreakdownPanel title={copy.geography} breakdown={data.geography} />
                <p>{copy.geoNote}</p>
                <Privacy data={data} copy={copy} />
                <CohortPanel title={copy.cohorts} rows={data.cohorts.retention} />
                <AudienceDaily data={data} />
              </div>
            ),
          },
          {
            id: "engagement",
            label: copy.engagement,
            content: (
              <div className={styles.section}>
                {metrics(copy.engagement, [
                  [copy.gained, number(data.subscribersGained)],
                  [copy.total, number(data.subscribersTotal)],
                ])}
                <Privacy data={data} copy={copy} />
                <p>
                  {data.cohorts.subscriberTrackingStartedAt
                    ? `${copy.tracking} ${date(data.cohorts.subscriberTrackingStartedAt)} (UTC).`
                    : copy.noTracking}
                </p>
                <CohortPanel
                  title={copy.subscriberCohorts}
                  rows={data.cohorts.subscriberRetention}
                />
                <section>
                  <h2>{copy.retention}</h2>
                  {data.retention.available ? (
                    <>
                      <p>
                        {copy.eligible}: {percent(data.retention.coverage)}
                      </p>
                      <DataTable
                        caption={copy.retention}
                        rows={data.retention.buckets}
                        rowKey={(row) => row.bucket}
                        columns={[
                          {
                            key: "bucket",
                            heading: copy.bucket,
                            rowHeader: true,
                            render: (row) => percent(row.threshold),
                          },
                          {
                            key: "viewers",
                            heading: copy.sessions,
                            render: (row) => number(row.viewers),
                          },
                          { key: "rate", heading: copy.rate, render: (row) => percent(row.rate) },
                        ]}
                      />
                    </>
                  ) : (
                    <StatusNotice>{copy.noRetention}</StatusNotice>
                  )}
                </section>
              </div>
            ),
          },
          {
            id: "playback",
            label: copy.playback,
            content: (
              <div className={styles.section}>
                <BreakdownPanel title={copy.protocols} breakdown={playback.protocols} />
                {metrics(copy.playback, [
                  [
                    copy.startup,
                    playback.startup.averageMs === null
                      ? copy.unavailable
                      : `${number(playback.startup.averageMs)} ${copy.ms}`,
                  ],
                  [copy.startupSamples, number(playback.startup.sampleCount)],
                  [copy.bufferEvents, number(playback.buffering.events)],
                  [copy.hlsFatal, number(playback.hlsFatalEvents)],
                  [copy.fallback, number(playback.mp4FallbackEvents)],
                  [copy.switches, number(playback.qualitySwitchEvents)],
                ])}
                <section>
                  <h2>{copy.buffering}</h2>
                  <Facts
                    items={[
                      [copy.eventsPerView, number(playback.buffering.eventsPerView)],
                      [copy.bufferSamples, number(playback.buffering.measuredDurationSamples)],
                      [
                        copy.bufferTotal,
                        `${number(playback.buffering.totalDurationMs)} ${copy.ms}`,
                      ],
                      [
                        copy.bufferAverage,
                        playback.buffering.averageDurationMs === null
                          ? copy.unavailable
                          : `${number(playback.buffering.averageDurationMs)} ${copy.ms}`,
                      ],
                    ]}
                  />
                </section>
                <section>
                  <h2>{copy.ads}</h2>
                  {data.advertising.available ? (
                    <Facts
                      items={[
                        [copy.requests, number(data.advertising.opportunities!)],
                        [copy.fills, number(data.advertising.fills!)],
                        [copy.fillRate, percent(data.advertising.fillRate!)],
                      ]}
                    />
                  ) : (
                    <StatusNotice>{copy.noAds}</StatusNotice>
                  )}
                  <p>{copy.adNote}</p>
                </section>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
export function StudioCreatorAnalytics() {
  const { copy } = useReportFormat();
  const [days, setDays] = useState(28),
    [revision, setRevision] = useState(0),
    [tab, setTab] = useState("overview");
  const query = `${days}:${revision}`;
  const [snapshot, setSnapshot] = useState<{
    query: string;
    data: CreatorAnalytics | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      setSnapshot({ query, data: null, error: true });
    }, 15000);
    void getStudioAnalytics(days, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot({ query, data, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSnapshot({ query, data: null, error: true });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [days, query]);
  const current = snapshot?.query === query ? snapshot : null;
  const refresh = () => setRevision((value) => value + 1);
  return (
    <div className={styles.workspace}>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <div className={styles.controls}>
            <SelectField
              id="studio-analytics-period"
              label={copy.range}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              {([7, 28, 90, 365] as const).map((value) => (
                <option key={value} value={value}>
                  {copy[`days${value}`]}
                </option>
              ))}
            </SelectField>
            <ActionButton tone="secondary" onClick={refresh} disabled={!current}>
              {copy.refresh}
            </ActionButton>
          </div>
        }
      />
      {!current && <StatusNotice announce="polite">{copy.loading}</StatusNotice>}
      {current?.error && (
        <StatusNotice tone="danger" announce="assertive">
          {copy.error} <ActionButton onClick={refresh}>{copy.retry}</ActionButton>
        </StatusNotice>
      )}
      {current?.data && (
        <AnalyticsReport key={query} data={current.data} tab={tab} onTab={setTab} />
      )}
    </div>
  );
}
