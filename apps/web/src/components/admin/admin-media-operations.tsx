"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  canReadMediaOperations,
  getAdaptiveOperations,
  getMediaOperations,
  submitMediaJobAction,
  type MediaJobAction,
  type MediaOperations,
} from "@/lib/admin-operator";
import { AdaptiveMediaActions } from "./adaptive-media-actions";
import {
  adaptiveLabel,
  adaptiveDescription,
  adaptiveFeedback,
  submitAdaptiveAction,
  type AdaptiveAction,
  type AdaptiveOutcome,
  type RecoveryMode,
} from "@/lib/admin-adaptive-actions";
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
  return <MediaWorkspace key={`${session?.accountId}:${session?.roles.join(",")}`} />;
}

function MediaWorkspace() {
  const { session } = useAdminAccess();
  const { locale, formatNumber, formatDate } = useI18n();
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<
    | { type: "job"; action: MediaJobAction; job: MediaOperations["jobs"][number] }
    | { type: "adaptive"; action: AdaptiveAction }
    | null
  >(null);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [batch, setBatch] = useState("2");
  const [mode, setMode] = useState<RecoveryMode>("STALE_PROCESSING");
  const [continuations, setContinuations] = useState<
    Partial<Record<RecoveryMode, AdaptiveOutcome["continuation"]>>
  >({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);
  const ar = locale === "ar";
  const text = (en: string, arabic: string) => (ar ? arabic : en);
  const state = (enabled: boolean) =>
    enabled ? text("Enabled", "مفعّل") : text("Disabled", "معطّل");
  function close() {
    dialog.current?.close();
    setSelected(null);
  }
  async function submit() {
    if (!selected || request.current) return;
    const target = selected;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFeedback(null);
    // Close before calling the API: STEP_UP_REQUIRED opens the shared identity dialog.
    // The original operation is never replayed after verification.
    close();
    try {
      if (target.type === "adaptive") {
        const outcome = await submitAdaptiveAction(target.action, controller.signal);
        if (!controller.signal.aborted) {
          setFeedback({ error: false, message: adaptiveFeedback(outcome, ar) });
          if (target.action.kind === "recovery" && outcome.continuation) {
            const recoveryMode = target.action.mode;
            setContinuations((current) => ({ ...current, [recoveryMode]: outcome.continuation }));
          }
        }
      } else {
        const outcome = await submitMediaJobAction(target.action, target.job, controller.signal);
        if (!controller.signal.aborted)
          setFeedback({
            error: false,
            message: text(
              `${target.job.video.title}: generation ${outcome.generation} queued. The action was audited; processing is not complete.`,
              `${target.job.video.title}: أُدرج الجيل ${formatNumber(outcome.generation)} في الطابور وسُجّل الإجراء للتدقيق. لم تكتمل المعالجة بعد.`,
            ),
          });
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setFeedback({
          error: true,
          message: `${cause instanceof Error ? cause.message : text("Request failed.", "تعذر الطلب.")} ${text(
            "Review the refreshed state before submitting again. A lost connection does not prove the action was cancelled.",
            "راجع الحالة المحدّثة قبل الإرسال مجددًا. انقطاع الاتصال لا يعني إلغاء الإجراء.",
          )}`,
        });
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
        setRevision((value) => value + 1);
      }
    }
  }
  return (
    <>
      {busy ? (
        <p role="status">{text("Submitting media action…", "جارٍ إرسال إجراء الوسائط…")}</p>
      ) : null}
      {feedback ? (
        <p
          role={feedback.error ? "alert" : "status"}
          className={feedback.error ? styles.error : styles.notice}
        >
          {feedback.message}
        </p>
      ) : null}
      <dialog
        ref={dialog}
        className={styles.verificationDialog}
        dir={ar ? "rtl" : "ltr"}
        aria-labelledby="media-action-title"
        aria-describedby="media-action-description"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <h2 id="media-action-title">
          {selected?.type === "adaptive"
            ? adaptiveLabel(selected.action, ar)
            : selected?.action === "retry"
              ? text("Retry processing", "إعادة محاولة المعالجة")
              : text("Reprocess video", "إعادة معالجة الفيديو")}
        </h2>
        {selected?.type === "job" ? (
          <p>
            <bdi>{selected.job.video.title}</bdi> — {text("Generation", "الجيل")}{" "}
            {formatNumber(selected.job.generation)}
          </p>
        ) : selected?.type === "adaptive" && "batchSize" in selected.action ? (
          <p>
            {text("Maximum items", "الحد الأقصى للعناصر")}:{" "}
            {formatNumber(selected.action.batchSize)}
          </p>
        ) : null}
        <p id="media-action-description">
          {selected?.type === "adaptive"
            ? adaptiveDescription(selected.action, ar)
            : selected?.action === "retry"
              ? text(
                  "Queue this failed generation again. The server rejects obsolete generations or another active job. This action is audited.",
                  "إعادة إدراج هذا الجيل الفاشل في الطابور. يرفض الخادم الأجيال القديمة أو وجود مهمة نشطة أخرى. يُسجّل الإجراء للتدقيق.",
                )
              : text(
                  "Create a new processing generation from the validated playback source. This uses processing capacity and storage. The server checks source availability and active jobs. This action is audited.",
                  "إنشاء جيل معالجة جديد من مصدر التشغيل المعتمد. يستهلك ذلك سعة معالجة وتخزين. يتحقق الخادم من توفر المصدر والمهام النشطة. يُسجّل الإجراء للتدقيق.",
                )}
        </p>
        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={close}>
            {text("Cancel", "إلغاء")}
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={busy || !selected}
            onClick={() => void submit()}
          >
            {selected?.type === "adaptive"
              ? text("Confirm action", "تأكيد الإجراء")
              : text("Confirm and queue", "تأكيد وإدراج في الطابور")}
          </button>
        </div>
      </dialog>
      <OperatorSnapshot
        title={text("Media operations", "عمليات الوسائط")}
        allowed={canReadMediaOperations(session?.roles ?? [])}
        load={loadMedia}
        revision={revision}
        readOnly={false}
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
                        {formatDate(worker.heartbeatAt, {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
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
              <h2 id="media-jobs-title">
                {text("Recent processing jobs", "مهام المعالجة الأخيرة")}
              </h2>
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
                    text("Actions", "الإجراءات"),
                  ]}
                >
                  {queue.jobs
                    .filter((job) =>
                      job.video.title
                        .toLocaleLowerCase()
                        .includes(query.trim().toLocaleLowerCase()),
                    )
                    .map((job) => (
                      <tr key={job.id}>
                        <th scope="row">
                          <bdi>{job.video.title}</bdi>
                          <p className={styles.muted}>
                            {text("Generation", "الجيل")} {formatNumber(job.generation)}
                          </p>
                          <details>
                            <summary>{text("Job reference", "مرجع المهمة")}</summary>
                            <code>{job.id}</code>
                          </details>
                        </th>
                        <td>
                          <bdi>{job.status}</bdi>
                          <br />
                          <small>
                            <bdi>{job.stage ?? "—"}</bdi>
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
                        <td>
                          {["FAILED", "READY"].includes(job.status) &&
                          !queue.jobs.some(
                            (other) =>
                              other.videoId === job.videoId &&
                              (other.generation > job.generation ||
                                [
                                  "INGESTING",
                                  "QUEUED",
                                  "PROCESSING",
                                  "UPLOADING",
                                  "VERIFYING",
                                ].includes(other.status)),
                          ) ? (
                            <div className={styles.actions}>
                              {job.status === "FAILED" ? (
                                <button
                                  className={styles.button}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setSelected({ type: "job", action: "retry", job })}
                                >
                                  {text("Retry processing", "إعادة محاولة المعالجة")}
                                </button>
                              ) : null}
                              <button
                                className={styles.button}
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setSelected({ type: "job", action: "reprocess", job })
                                }
                              >
                                {text("Reprocess video", "إعادة معالجة الفيديو")}
                              </button>
                            </div>
                          ) : (
                            <span className={styles.muted}>
                              {text("No action for this state", "لا إجراء لهذه الحالة")}
                            </span>
                          )}
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
              <AdaptiveMediaActions
                open={maintenanceOpen}
                setOpen={setMaintenanceOpen}
                controls={adaptive.controls}
                superadmin={session?.roles.includes("SUPERADMIN") ?? false}
                busy={busy}
                ar={ar}
                batch={batch}
                setBatch={setBatch}
                mode={mode}
                setMode={setMode}
                continuation={continuations[mode]}
                resetScan={() => setContinuations((current) => ({ ...current, [mode]: undefined }))}
                select={(action) => setSelected({ type: "adaptive", action })}
              />
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
                  [
                    text("HLS output bytes", "حجم HLS بالبايت"),
                    adaptive.metrics.outputStorageBytes,
                  ],
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
    </>
  );
}
