"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  getTrendingConfig,
  saveTrendingConfig,
  trendingFields,
  validTrending,
  weightLabels,
  type TrendingConfig,
  type TrendingWeight,
} from "@/lib/admin-discovery-operations";

export function TrendingSettings() {
  const { locale, formatNumber } = useI18n();
  const ar = locale === "ar",
    text = (en: string, arabic: string) => (ar ? arabic : en);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    config: TrendingConfig | null;
    error: string;
  } | null>(null);
  const [draft, setDraft] = useState<TrendingConfig | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [review, setReview] = useState<{ config: TrendingConfig; reason: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (review) dialog.current?.showModal();
  }, [review]);
  useEffect(() => {
    const controller = new AbortController();
    void getTrendingConfig(controller.signal)
      .then((config) => {
        if (!controller.signal.aborted) {
          setSnapshot({ revision, config, error: "" });
          setDraft(config);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setSnapshot({
            revision,
            config: null,
            error: cause instanceof Error ? cause.message : "Trending settings unavailable.",
          });
      });
    return () => controller.abort();
  }, [revision]);
  const current = snapshot?.revision === revision ? snapshot : null;
  const saved = current?.config;
  const dirty = saved && draft && JSON.stringify(saved) !== JSON.stringify(draft);
  const valid =
    draft && validTrending(draft) && reason.trim().length >= 3 && reason.trim().length <= 500;
  function close() {
    dialog.current?.close();
    setReview(null);
  }
  async function save() {
    if (!review || request.current) return;
    const target = review,
      controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFeedback(null);
    close();
    try {
      const config = await saveTrendingConfig(target.config, target.reason, controller.signal);
      if (!controller.signal.aborted) {
        setSnapshot({ revision, config, error: "" });
        setDraft(config);
        setReason("");
        setFeedback({
          error: false,
          message: text(
            "Trending settings saved. The change and reason were audited.",
            "حُفظت إعدادات الرائج وسُجّل التغيير وسببه للتدقيق.",
          ),
        });
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setFeedback({
          error: true,
          message: `${cause instanceof Error ? cause.message : text("Save failed.", "تعذر الحفظ.")} ${text("Your draft is retained. Reload saved settings before retrying after a connection failure; a lost response does not prove cancellation.", "احتُفظ بالمسودة. أعد تحميل الإعدادات المحفوظة قبل المحاولة بعد انقطاع الاتصال؛ فقدان الرد لا يعني إلغاء التغيير.")}`,
        });
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  const changes =
    saved && review
      ? [
          ...trendingFields
            .filter(({ key }) => saved[key] !== review.config[key])
            .map((field) => ({
              label: ar ? field.ar : field.en,
              before: saved[field.key],
              after: review.config[field.key],
            })),
          ...(Object.keys(weightLabels) as TrendingWeight[])
            .filter((key) => saved.weights[key] !== review.config.weights[key])
            .map((key) => ({
              label: weightLabels[key][ar ? 1 : 0],
              before: saved.weights[key],
              after: review.config.weights[key],
            })),
        ]
      : [];
  return (
    <section className={styles.card} aria-labelledby="trending-settings-title">
      <div className={styles.cardHeader}>
        <h2 id="trending-settings-title">{text("Trending settings", "إعدادات الرائج")}</h2>
        <button
          className={styles.button}
          type="button"
          disabled={busy || !current}
          onClick={() => {
            setRevision((value) => value + 1);
            setReason("");
            setFeedback(null);
          }}
        >
          {dirty
            ? text("Discard draft and reload", "إلغاء المسودة وإعادة التحميل")
            : text("Reload saved settings", "إعادة تحميل الإعدادات المحفوظة")}
        </button>
      </div>
      <p>
        {text(
          "These settings affect global and regional ranking. Audience thresholds and per-session caps protect small cohorts and limit manipulation.",
          "تؤثر هذه الإعدادات في الترتيب العالمي والإقليمي. تحمي حدود الجمهور وحدود الجلسة المجموعات الصغيرة وتحد من التلاعب.",
        )}
      </p>
      {!current ? (
        <p role="status">{text("Loading trending settings…", "جارٍ تحميل إعدادات الرائج…")}</p>
      ) : null}
      {current?.error ? (
        <p role="alert" className={styles.error}>
          {current.error}
        </p>
      ) : null}
      {busy ? (
        <p role="status">{text("Saving trending settings…", "جارٍ حفظ إعدادات الرائج…")}</p>
      ) : null}
      {feedback ? (
        <p
          role={feedback.error ? "alert" : "status"}
          className={feedback.error ? styles.error : styles.notice}
        >
          {feedback.message}
        </p>
      ) : null}
      {saved && draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && dirty && !busy)
              setReview({ config: structuredClone(draft), reason: reason.trim() });
          }}
        >
          <fieldset disabled={busy} className={styles.operatorFieldset}>
            <legend>{text("Ranking and audience", "الترتيب والجمهور")}</legend>
            <div className={styles.formGrid}>
              {trendingFields.slice(0, 5).map((field) => (
                <label key={field.key}>
                  {ar ? field.ar : field.en}
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step === 1 ? 1 : "any"}
                    required
                    value={Number.isFinite(draft[field.key]) ? draft[field.key] : ""}
                    onChange={(event) =>
                      setDraft({ ...draft, [field.key]: event.target.valueAsNumber })
                    }
                  />
                </label>
              ))}
            </div>
            <details>
              <summary>{text("Advanced limits and weights", "الحدود والأوزان المتقدمة")}</summary>
              <div className={styles.formGrid}>
                {trendingFields.slice(5).map((field) => (
                  <label key={field.key}>
                    {ar ? field.ar : field.en}
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step === 1 ? 1 : "any"}
                      required
                      value={Number.isFinite(draft[field.key]) ? draft[field.key] : ""}
                      onChange={(event) =>
                        setDraft({ ...draft, [field.key]: event.target.valueAsNumber })
                      }
                    />
                  </label>
                ))}
                {(Object.keys(weightLabels) as TrendingWeight[]).map((key) => (
                  <label key={key}>
                    {weightLabels[key][ar ? 1 : 0]}
                    <input
                      type="number"
                      min={0}
                      max={3}
                      step="any"
                      required
                      value={Number.isFinite(draft.weights[key]) ? draft.weights[key] : ""}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          weights: { ...draft.weights, [key]: event.target.valueAsNumber },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            <p className={styles.muted}>
              {text(
                "Recent activity must fit inside the ranking window. Regional audience cannot be smaller than global audience. At least one positive ranking weight must remain above zero.",
                "يجب أن تكون نافذة النشاط أقصر من نافذة الترتيب، وألا يقل الجمهور الإقليمي عن العالمي، وأن يبقى وزن ترتيب إيجابي واحد على الأقل أكبر من صفر.",
              )}
            </p>
            <div className={styles.formGrid}>
              <label>
                {text("Reason for change", "سبب التغيير")}
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            </div>
            {dirty && !validTrending(draft) ? (
              <p role="alert" className={styles.error}>
                {text(
                  "Check the limits and relationships above before saving.",
                  "راجع الحدود والعلاقات الموضحة أعلاه قبل الحفظ.",
                )}
              </p>
            ) : null}
            <button className={styles.button} type="submit" disabled={!dirty || !valid}>
              {text("Review trending changes", "مراجعة تغييرات الرائج")}
            </button>
          </fieldset>
        </form>
      ) : null}
      <dialog
        ref={dialog}
        className={styles.verificationDialog}
        dir={ar ? "rtl" : "ltr"}
        aria-labelledby="trending-review-title"
        aria-describedby="trending-review-description"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <h2 id="trending-review-title">
          {text("Confirm trending changes", "تأكيد تغييرات الرائج")}
        </h2>
        <p id="trending-review-description">
          {text(
            "Apply these changes to discovery ranking. Your current role and recent verification are checked again; the reason is audited.",
            "تطبيق هذه التغييرات على ترتيب الاكتشاف. يُعاد التحقق من دورك والتحقق الإضافي الحديث، ويُسجّل السبب للتدقيق.",
          )}
        </p>
        <ul>
          {changes.map((change) => (
            <li key={change.label}>
              {change.label}:{" "}
              <bdi>
                {formatNumber(change.before)} → {formatNumber(change.after)}
              </bdi>
            </li>
          ))}
        </ul>
        <p>
          <strong>{text("Reason", "السبب")}:</strong> <bdi>{review?.reason}</bdi>
        </p>
        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={close}>
            {text("Cancel", "إلغاء")}
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={busy || !review}
            onClick={() => void save()}
          >
            {text("Confirm and save", "تأكيد وحفظ")}
          </button>
        </div>
      </dialog>
    </section>
  );
}
