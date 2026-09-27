"use client";
import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { canReadObservability, getObservability } from "@/lib/admin-observability";
import { useAdminAccess } from "./admin-access";
import { OperatorSnapshot, OperatorTable } from "./operator-snapshot";
export function AdminObservability() {
  const { session } = useAdminAccess();
  const { locale, formatNumber } = useI18n();
  const text = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const number = (value: number) => formatNumber(value, { maximumFractionDigits: 2 });
  const facts = (rows: Array<[string, number]>) => (
    <dl className={styles.operatorFacts}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{number(value)}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <OperatorSnapshot
      title={text("Service observability", "مراقبة الخدمة")}
      allowed={canReadObservability(session?.roles ?? [])}
      load={getObservability}
    >
      {(data) => (
        <>
          <section className={styles.operatorSection} aria-labelledby="telemetry-status">
            <h2 id="telemetry-status">{text("Telemetry connection", "اتصال المراقبة")}</h2>
            <p>
              {data.telemetry.externalConnected
                ? text(
                    "External telemetry reports connected. This does not verify delivery or fleet coverage.",
                    "تبلغ المراقبة الخارجية عن اتصال. هذا لا يثبت التسليم أو تغطية جميع الخوادم.",
                  )
                : text(
                    "External telemetry is not connected. This snapshot uses local process metrics and database records.",
                    "المراقبة الخارجية غير متصلة. تستخدم هذه اللقطة مقاييس العملية المحلية وسجلات قاعدة البيانات.",
                  )}
            </p>
            <dl className={styles.operatorFacts}>
              <div>
                <dt>{text("Provider", "المزود")}</dt>
                <dd>
                  <bdi>{data.telemetry.provider}</bdi>
                </dd>
              </div>
              <div>
                <dt>{text("Release", "الإصدار")}</dt>
                <dd>
                  <bdi>
                    {data.releaseSha === "unknown"
                      ? text("Not reported", "غير مسجل")
                      : data.releaseSha}
                  </bdi>
                </dd>
              </div>
            </dl>
          </section>
          <section className={styles.operatorSection} aria-labelledby="request-sample">
            <h2 id="request-sample">{text("API request sample", "عينة طلبات API")}</h2>
            <p>
              {text(
                `This responding process retains up to ${number(data.api.sampleLimit)} requests from the last ${number(data.api.windowSeconds)} seconds. These are sampled process figures, not total platform traffic.`,
                `تحتفظ العملية المستجيبة بما يصل إلى ${number(data.api.sampleLimit)} طلب من آخر ${number(data.api.windowSeconds)} ثانية. هذه عينة محلية وليست إجمالي حركة المنصة.`,
              )}
            </p>
            {data.api.requests === 0 ? (
              <p>
                {text(
                  "No requests are retained in this process window. This does not establish an outage.",
                  "لا توجد طلبات محفوظة في نافذة هذه العملية. هذا لا يثبت وجود انقطاع.",
                )}
              </p>
            ) : null}
            {data.api.requests >= data.api.sampleLimit ? (
              <p className={styles.notice}>
                {text(
                  "The sample limit is reached; traffic beyond this retained sample is not represented.",
                  "بلغت العينة الحد الأقصى؛ لا تمثل الحركة خارج العينة المحفوظة.",
                )}
              </p>
            ) : null}
            {facts([
              [text("Retained requests", "الطلبات المحفوظة"), data.api.requests],
              [
                text(
                  "Retained requests per window second",
                  "الطلبات المحفوظة لكل ثانية من النافذة",
                ),
                data.api.requestsPerSecond,
              ],
            ])}
            <OperatorTable
              label={text("Response classes in the sample", "فئات الاستجابة في العينة")}
              headings={[text("HTTP class", "فئة HTTP"), text("Requests", "الطلبات")]}
            >
              {Object.entries(data.api.statusClasses).map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">
                    <bdi>{key}</bdi>
                  </th>
                  <td>{number(value)}</td>
                </tr>
              ))}
            </OperatorTable>
            <h3>{text("Sample latency (milliseconds)", "زمن استجابة العينة (مللي ثانية)")}</h3>
            {data.api.requests ? (
              facts([
                [text("Average", "المتوسط"), data.api.latencyMs.average],
                ["P50", data.api.latencyMs.p50],
                ["P95", data.api.latencyMs.p95],
                [text("Maximum", "الأقصى"), data.api.latencyMs.max],
              ])
            ) : (
              <p>
                {text(
                  "Latency is unavailable without retained requests.",
                  "لا يتوفر زمن الاستجابة دون طلبات محفوظة.",
                )}
              </p>
            )}
          </section>
          <section className={styles.operatorSection} aria-labelledby="processing-state">
            <h2 id="processing-state">{text("Processing records", "سجلات المعالجة")}</h2>
            <p>
              {text(
                "Database job counts are not a worker heartbeat. Failures and retried jobs include retained history and are not rates for the request window.",
                "أعداد المهام في قاعدة البيانات ليست إشارة حياة للعامل. تشمل المهام الفاشلة والمعادة السجل المحتفظ به ولا تمثل معدلات نافذة الطلبات.",
              )}
            </p>
            {facts([
              [text("Queued", "في الطابور"), data.worker.queueDepth],
              [text("Active processing", "معالجة نشطة"), data.worker.activeJobs],
              [text("Failed jobs", "المهام الفاشلة"), data.worker.failures],
              [
                text("Jobs with retries", "المهام ذات المحاولات المتكررة"),
                data.worker.jobsWithRetries,
              ],
            ])}
            <p>
              {data.worker.queueDepth
                ? text(
                    `Oldest queued age: ${number(data.worker.oldestQueuedAgeSeconds)} seconds.`,
                    `عمر أقدم مهمة في الطابور: ${number(data.worker.oldestQueuedAgeSeconds)} ثانية.`,
                  )
                : text("No jobs are currently queued.", "لا توجد مهام في الطابور حاليًا.")}
            </p>
          </section>
          <section className={styles.operatorSection} aria-labelledby="error-counters">
            <h2 id="error-counters">{text("Error evidence", "سجل الأخطاء")}</h2>
            <p>
              {text(
                "Process counters reset when this API process restarts. Counts can overlap; do not add categories to infer unique incidents.",
                "تُصفّر عدادات العملية عند إعادة تشغيل عملية API هذه. قد تتداخل الأعداد؛ لا تجمع الفئات لاستنتاج حوادث منفردة.",
              )}
            </p>
            {Object.keys(data.errors.counters).length ? (
              <OperatorTable
                label={text("Process lifetime counters", "عدادات عمر العملية")}
                headings={[text("Category", "الفئة"), text("Count", "العدد")]}
              >
                {Object.entries(data.errors.counters)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, value]) => (
                    <tr key={key}>
                      <th scope="row">
                        <bdi>{key}</bdi>
                      </th>
                      <td>{number(value)}</td>
                    </tr>
                  ))}
              </OperatorTable>
            ) : (
              <p>
                {text(
                  "No error counters recorded in this process.",
                  "لم تسجل عدادات أخطاء في هذه العملية.",
                )}
              </p>
            )}
            {facts([
              [
                text(
                  "Recorded ad errors in the last 24 hours",
                  "أخطاء الإعلانات المسجلة خلال آخر 24 ساعة",
                ),
                data.errors.adIntegrationLast24Hours,
              ],
            ])}
            <p className={styles.muted}>
              {text(
                "Ad errors come from database analytics events; they do not establish provider fill, delivery or revenue loss.",
                "تأتي أخطاء الإعلانات من أحداث التحليلات في قاعدة البيانات؛ لا تثبت تعبئة المزود أو التسليم أو خسارة الإيرادات.",
              )}
            </p>
          </section>
        </>
      )}
    </OperatorSnapshot>
  );
}
