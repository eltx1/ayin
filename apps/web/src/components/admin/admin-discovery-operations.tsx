"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { canReadOperations } from "@/lib/admin-operator";
import {
  getFixtureEvaluation,
  getObservedVersions,
  getObservedSample,
  metricLabels,
  summarizeObserved,
  type EvaluationMetric,
  type FixtureEvaluation,
  type ObservedSample,
  type ObservedVersion,
} from "@/lib/admin-discovery-operations";
import { useAdminAccess } from "./admin-access";
import { OperatorSnapshot, OperatorTable } from "./operator-snapshot";
import { TrendingSettings } from "./trending-settings";

async function loadDiscovery(signal: AbortSignal) {
  const [fixture, versions] = await Promise.all([
    getFixtureEvaluation("balanced", signal),
    getObservedVersions(signal),
  ]);
  return { fixture, versions };
}
export function AdminDiscoveryOperations() {
  const { session } = useAdminAccess();
  const { locale } = useI18n();
  const allowed = canReadOperations(session?.roles ?? []);
  return (
    <div key={`${session?.accountId}:${session?.roles.join(",")}`}>
      <OperatorSnapshot
        title={locale === "ar" ? "الاكتشاف والرائج" : "Discovery & trending"}
        allowed={allowed}
        load={loadDiscovery}
      >
        {({ fixture, versions }) => (
          <RecommendationEvidence initialFixture={fixture} versions={versions} />
        )}
      </OperatorSnapshot>
      {allowed && session ? <TrendingSettings /> : null}
    </div>
  );
}
function RecommendationEvidence({
  initialFixture,
  versions,
}: {
  initialFixture: FixtureEvaluation;
  versions: ObservedVersion[];
}) {
  const { locale, formatNumber, formatDate } = useI18n();
  const ar = locale === "ar",
    text = (en: string, arabic: string) => (ar ? arabic : en);
  const [fixture, setFixture] = useState(initialFixture);
  const [candidate, setCandidate] = useState<"balanced" | "watch-only">("balanced");
  const [version, setVersion] = useState(versions[0]?.versionId ?? "");
  const [sample, setSample] = useState<ObservedSample | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function evaluate(observed: boolean) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    if (observed) setSample(null);
    try {
      if (observed) {
        const result = await getObservedSample(version, controller.signal);
        if (!controller.signal.aborted) setSample(result);
      } else {
        const result = await getFixtureEvaluation(candidate, controller.signal);
        if (!controller.signal.aborted) setFixture(result);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : text("Evaluation unavailable.", "التقييم غير متاح."),
        );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  const summary = sample ? summarizeObserved(sample) : null;
  return (
    <>
      {busy ? <p role="status">{text("Loading evaluation…", "جارٍ تحميل التقييم…")}</p> : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <section className={styles.operatorSection} aria-labelledby="fixture-title">
        <h2 id="fixture-title">
          {text("Offline fixture comparison", "مقارنة عينة الاختبار الثابتة")}
        </h2>
        <p>
          {text(
            "Fixed labelled examples, not production performance or release approval. Precision and recall are fixture proxies; no rollout is changed here.",
            "أمثلة اختبار ثابتة وموسومة، وليست أداء الإنتاج أو موافقة على النشر. الدقة والاسترجاع مؤشرات لهذه العينة؛ لا يتغير طرح التوصيات هنا.",
          )}
        </p>
        <div className={styles.toolbar}>
          <label htmlFor="fixture-candidate">
            {text("Fixture candidate", "مرشح عينة الاختبار")}
          </label>
          <select
            id="fixture-candidate"
            value={candidate}
            disabled={busy}
            onChange={(event) => setCandidate(event.target.value as "balanced" | "watch-only")}
          >
            <option value="balanced">{text("Balanced sample", "عينة متوازنة")}</option>
            <option value="watch-only">{text("Watch-only sample", "عينة وقت المشاهدة فقط")}</option>
          </select>
          <button
            className={styles.button}
            type="button"
            disabled={busy}
            onClick={() => void evaluate(false)}
          >
            {text("Compare fixture", "مقارنة العينة")}
          </button>
        </div>
        <p>
          {text("Fixture", "العينة")}: <bdi>{fixture.fixtureId}</bdi> · {text("Cases", "الحالات")}:{" "}
          {formatNumber(fixture.candidate.cases)}
        </p>
        <p role="status">
          {fixture.baseline.cases === 0 || fixture.candidate.cases === 0
            ? text("Insufficient fixture evidence.", "أدلة عينة الاختبار غير كافية.")
            : fixture.releaseAssessment.pass
              ? text(
                  "Fixture guardrails passed. Production validation is still required.",
                  "اجتازت العينة حدود التقييم. يظل التحقق من الإنتاج مطلوبًا.",
                )
              : text(
                  "Fixture guardrails failed. Review the metric differences.",
                  "لم تجتز العينة حدود التقييم. راجع فروق المؤشرات.",
                )}
        </p>
        <OperatorTable
          label={text("Fixture metrics", "مؤشرات عينة الاختبار")}
          headings={[
            text("Metric", "المؤشر"),
            fixture.baseline.versionId,
            fixture.candidate.versionId,
            text("Difference (percentage points)", "الفرق (نقاط مئوية)"),
          ]}
        >
          {(Object.keys(metricLabels) as EvaluationMetric[]).map((key) => (
            <tr key={key}>
              <th scope="row">{metricLabels[key][ar ? 1 : 0]}</th>
              <td>
                {formatNumber(fixture.baseline[key], {
                  style: "percent",
                  maximumFractionDigits: 1,
                })}
              </td>
              <td>
                {formatNumber(fixture.candidate[key], {
                  style: "percent",
                  maximumFractionDigits: 1,
                })}
              </td>
              <td>
                <bdi>
                  {formatNumber(fixture.releaseAssessment.delta[key] * 100, {
                    maximumFractionDigits: 1,
                    signDisplay: "always",
                  })}
                </bdi>
              </td>
            </tr>
          ))}
        </OperatorTable>
        {fixture.releaseAssessment.blockers.length ? (
          <ul>
            {fixture.releaseAssessment.blockers.map((blocker) => (
              <li key={blocker}>
                <bdi>{metricLabels[blocker as EvaluationMetric]?.[ar ? 1 : 0] ?? blocker}</bdi>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className={styles.operatorSection} aria-labelledby="observed-title">
        <h2 id="observed-title">
          {text("Observed recommendation versions", "نسخ التوصيات المرصودة")}
        </h2>
        <p>
          {text(
            "Exposure records from the last 30 days, grouped by version, algorithm, surface and mode. Counts are records, not unique people.",
            "سجلات عرض آخر 30 يومًا، مجمّعة حسب النسخة والخوارزمية والموضع والوضع. الأعداد للسجلات وليست لأشخاص فريدين.",
          )}
        </p>
        {versions.length ? (
          <>
            <OperatorTable
              label={text("Observed versions", "النسخ المرصودة")}
              headings={[
                text("Version / algorithm", "النسخة / الخوارزمية"),
                text("Surface / mode", "الموضع / الوضع"),
                text("Records", "السجلات"),
                text("Last observed", "آخر رصد"),
              ]}
            >
              {versions.map((row, index) => (
                <tr key={`${row.versionId}:${row.surface}:${row.mode}:${index}`}>
                  <th scope="row">
                    <bdi>{row.versionId}</bdi>
                    <br />
                    <small>
                      <bdi>{row.algorithmId}</bdi>
                    </small>
                  </th>
                  <td>
                    <bdi>
                      {row.surface} / {row.mode}
                    </bdi>
                  </td>
                  <td>{formatNumber(row.exposures)}</td>
                  <td>{formatDate(row.lastSeenAt, { dateStyle: "short", timeStyle: "short" })}</td>
                </tr>
              ))}
            </OperatorTable>
            <div className={styles.toolbar}>
              <label htmlFor="observed-version">
                {text("Observed version", "النسخة المرصودة")}
              </label>
              <select
                id="observed-version"
                value={version}
                disabled={busy}
                onChange={(event) => {
                  setVersion(event.target.value);
                  setSample(null);
                }}
              >
                {[...new Set(versions.map((row) => row.versionId))].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <button
                className={styles.button}
                type="button"
                disabled={busy || !version}
                onClick={() => void evaluate(true)}
              >
                {text("Inspect recent sample", "فحص عينة حديثة")}
              </button>
            </div>
            <p className={styles.muted}>
              {text(
                "Up to 100 recent exposures over 14 days. Missing attribution is not a zero outcome. Recall for unshown content cannot be inferred from this sample.",
                "حتى 100 سجل عرض حديث خلال 14 يومًا. غياب الربط لا يعني نتيجة صفرية. لا يمكن استنتاج استرجاع المحتوى غير المعروض من هذه العينة.",
              )}
            </p>
            {sample && summary ? (
              sample.exposures.length ? (
                <dl className={styles.operatorFacts}>
                  {[
                    [text("Sample records", "سجلات العينة"), formatNumber(sample.exposures.length)],
                    [
                      text("Records with attributed events", "سجلات مرتبطة بأحداث"),
                      formatNumber(sample.telemetryCoverage, {
                        style: "percent",
                        maximumFractionDigits: 1,
                      }),
                    ],
                    [
                      text("Recorded item impressions", "مرات عرض العناصر المسجلة"),
                      formatNumber(summary.impressions),
                    ],
                    [
                      text("Recorded item clicks", "نقرات العناصر المسجلة"),
                      formatNumber(summary.clicks),
                    ],
                    [
                      text("Recorded completions", "الإكمالات المسجلة"),
                      formatNumber(summary.completions),
                    ],
                    [
                      text("Attributed watch time (minutes)", "وقت المشاهدة المرتبط (دقائق)"),
                      formatNumber(summary.watchTimeMs / 60000, { maximumFractionDigits: 1 }),
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>
                  {text(
                    "No exposures in this 14-day sample.",
                    "لا توجد سجلات عرض في عينة الأربعة عشر يومًا.",
                  )}
                </p>
              )
            ) : null}
          </>
        ) : (
          <p>
            {text(
              "No recommendation versions observed in the last 30 days.",
              "لم تُرصد نسخ توصيات خلال آخر 30 يومًا.",
            )}
          </p>
        )}
      </section>
    </>
  );
}
