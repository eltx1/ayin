"use client";

import { useState } from "react";
import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  canReadMediaOperations,
  getAdaptiveOperations,
  getMediaOperations,
} from "@/lib/admin-operator";
import { useAdminAccess } from "./admin-access";
import { OperatorSnapshot, OperatorTable } from "./operator-snapshot";

async function loadMedia(signal: AbortSignal) {
  const [queue, adaptive] = await Promise.all([
    getMediaOperations(signal),
    getAdaptiveOperations(signal),
  ]);
  return { queue, adaptive };
}

export function AdminMediaOperations() {
  const { session } = useAdminAccess();
  const { locale, formatNumber, formatDate } = useI18n();
  const [query, setQuery] = useState("");
  const ar = locale === "ar";
  const text = (en: string, arabic: string) => (ar ? arabic : en);
  const state = (enabled: boolean) =>
    enabled ? text("Enabled", "مفعّل") : text("Disabled", "معطّل");
  return (
    <OperatorSnapshot
      title={text("Media operations", "عمليات الوسائط")}
      allowed={canReadMediaOperations(session?.roles ?? [])}
      load={loadMedia}
    >
      {({ queue, adaptive }) => (
        <>
          <section
            aria-label={text("Processing capacity", "سعة المعالجة")}
            className={styles.metrics}
          >
            {[
              [text("Processing", "المعالجة"), state(queue.capacity.enabled)],
              [text("Active jobs", "المهام النشطة"), formatNumber(queue.active)],
              [text("Queued jobs", "المهام المنتظرة"), formatNumber(queue.counts.QUEUED ?? 0)],
              [
                text("Concurrency limit", "حد التزامن"),
                formatNumber(queue.capacity.concurrentJobs),
              ],
            ].map(([label, value]) => (
              <article className={styles.metric} key={label}>
                <span className={styles.muted}>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          <section className={styles.operatorSection} aria-labelledby="media-workers-title">
            <h2 id="media-workers-title">{text("Active workers", "العاملون النشطون")}</h2>
            {queue.workers.length ? (
              <OperatorTable
                label={text("Worker state reported by the queue", "حالة العاملين حسب الطابور")}
                headings={[
                  text("Host", "المضيف"),
                  text("State", "الحالة"),
                  text("Active / limit", "النشط / الحد"),
                  text("Last heartbeat", "آخر اتصال"),
                ]}
              >
                {queue.workers.map((worker) => (
                  <tr key={worker.id}>
                    <th scope="row">
                      <bdi>{worker.hostName}</bdi>
                    </th>
                    <td>
                      <bdi>{worker.status}</bdi>
                    </td>
                    <td>
                      {formatNumber(worker.activeJobCount)} /{" "}
                      {formatNumber(worker.concurrencyLimit)}
                    </td>
                    <td>
                      {formatDate(worker.heartbeatAt, { dateStyle: "short", timeStyle: "medium" })}
                    </td>
                  </tr>
                ))}
              </OperatorTable>
            ) : (
              <p>
                {text(
                  "No active workers are reported. Queued work may remain waiting.",
                  "لا يوجد عامل نشط حسب البيانات الحالية. قد تبقى المهام في الانتظار.",
                )}
              </p>
            )}
          </section>
          <section className={styles.operatorSection} aria-labelledby="media-jobs-title">
            <h2 id="media-jobs-title">{text("Recent processing jobs", "مهام المعالجة الأخيرة")}</h2>
            <p className={styles.muted}>
              {text(
                "At most 100 recently updated jobs. Search filters this snapshot, not the entire history.",
                "آخر 100 مهمة محدّثة كحد أقصى. البحث يرشح هذه اللقطة فقط، وليس السجل الكامل.",
              )}
            </p>
            <div className={styles.toolbar}>
              <label htmlFor="media-job-query">{text("Find a video", "البحث عن فيديو")}</label>
              <input
                id="media-job-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                type="search"
              />
            </div>
            {queue.jobs.filter((job) =>
              job.video.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
            ).length ? (
              <OperatorTable
                label={text("Latest jobs", "آخر المهام")}
                headings={[
                  text("Video", "الفيديو"),
                  text("State / stage", "الحالة / المرحلة"),
                  text("Progress", "التقدم"),
                  text("Attempt", "المحاولة"),
                  text("Updated", "آخر تحديث"),
                ]}
              >
                {queue.jobs
                  .filter((job) =>
                    job.video.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
                  )
                  .map((job) => (
                    <tr key={job.id}>
                      <th scope="row">
                        <bdi>{job.video.title}</bdi>
                        <details>
                          <summary>{text("Job reference", "مرجع المهمة")}</summary>
                          <code>{job.id}</code>
                        </details>
                      </th>
                      <td>
                        <bdi>{job.status}</bdi>
                        <br />
                        <small>
                          <bdi>{job.stage}</bdi>
                        </small>
                        {job.errorCode ? (
                          <p>
                            <bdi>{job.errorCode}</bdi>
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <progress
                          aria-label={`${text("Progress", "التقدم")}: ${job.video.title}`}
                          value={job.progressPercent}
                          max={100}
                        />
                        <br />
                        {formatNumber(job.progressPercent)}%
                      </td>
                      <td>{formatNumber(job.attempt)}</td>
                      <td>
                        {formatDate(job.updatedAt, { dateStyle: "short", timeStyle: "medium" })}
                      </td>
                    </tr>
                  ))}
              </OperatorTable>
            ) : (
              <p>
                {queue.jobs.length
                  ? text("No titles match this search.", "لا توجد عناوين مطابقة للبحث.")
                  : text("No processing jobs have been reported.", "لم تُسجل مهام معالجة.")}
              </p>
            )}
          </section>
          <section className={styles.operatorSection} aria-labelledby="adaptive-title">
            <h2 id="adaptive-title">{text("Adaptive HLS rollout", "طرح HLS التكيفي")}</h2>
            <dl className={styles.operatorFacts}>
              {[
                [text("Generation", "إنشاء النسخ"), state(adaptive.controls.generationEnabled)],
                [text("Playback", "التشغيل"), state(adaptive.controls.playbackEnabled)],
                [
                  text("New uploads", "الملفات الجديدة"),
                  state(adaptive.controls.newUploadsEnabled),
                ],
                [
                  text("Backfill", "تحويل المحتوى السابق"),
                  state(adaptive.controls.backfillEnabled),
                ],
                [
                  text("Backfill paused", "إيقاف التحويل مؤقتًا"),
                  adaptive.controls.backfillPaused ? text("Yes", "نعم") : text("No", "لا"),
                ],
                [
                  text("Batch / in-flight limit", "الدفعة / حد المهام الجارية"),
                  `${formatNumber(adaptive.controls.batchSize)} / ${formatNumber(adaptive.controls.maxInFlight)}`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.metrics}>
              {[
                [text("Adaptive ready", "جاهز للتكيف"), adaptive.catalog.adaptiveReady],
                [text("Fallback only", "نسخة احتياطية فقط"), adaptive.catalog.fallbackOnly],
                [text("Backfill queued", "تحويلات منتظرة"), adaptive.catalog.queued],
                [text("Backfill failed", "تحويلات فاشلة"), adaptive.catalog.failed],
              ].map(([label, value]) => (
                <article className={styles.metric} key={label}>
                  <span className={styles.muted}>{label}</span>
                  <strong>{formatNumber(Number(value))}</strong>
                </article>
              ))}
            </div>
            <p>
              {text("Playback events over the last", "أحداث التشغيل خلال آخر")}{" "}
              {formatNumber(adaptive.metrics.windowDays)} {text("days", "يومًا")}
            </p>
            <dl className={styles.operatorFacts}>
              {[
                [text("HLS starts", "بدء HLS"), formatNumber(adaptive.metrics.hlsStartupSuccess)],
                [
                  text("Fatal adaptive failures", "إخفاقات تكيفية نهائية"),
                  formatNumber(adaptive.metrics.fatalAdaptiveFailure),
                ],
                [
                  text("MP4 fallback events", "أحداث الرجوع إلى MP4"),
                  formatNumber(adaptive.metrics.mp4Fallbacks),
                ],
                [
                  text("Fallback rate", "معدل الرجوع"),
                  formatNumber(adaptive.metrics.mp4FallbackRate, {
                    style: "percent",
                    maximumFractionDigits: 2,
                  }),
                ],
                [text("HLS output bytes", "حجم HLS بالبايت"), adaptive.metrics.outputStorageBytes],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <bdi>{value}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </OperatorSnapshot>
  );
}
