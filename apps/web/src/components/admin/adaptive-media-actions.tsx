"use client";

import styles from "@/app/admin/admin.module.css";
import type { AdaptiveOperations } from "@/lib/admin-operator";
import {
  adaptiveDescription,
  adaptiveLabel,
  recoveryModes,
  type AdaptiveAction,
  type AdaptiveOutcome,
  type RecoveryMode,
} from "@/lib/admin-adaptive-actions";

export function AdaptiveMediaActions({
  open,
  setOpen,
  controls,
  superadmin,
  busy,
  ar,
  batch,
  setBatch,
  mode,
  setMode,
  continuation,
  resetScan,
  select,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  controls: AdaptiveOperations["controls"];
  superadmin: boolean;
  busy: boolean;
  ar: boolean;
  batch: string;
  setBatch: (value: string) => void;
  mode: RecoveryMode;
  setMode: (value: RecoveryMode) => void;
  continuation?: AdaptiveOutcome["continuation"];
  resetScan: () => void;
  select: (action: AdaptiveAction) => void;
}) {
  const text = (en: string, arabic: string) => (ar ? arabic : en);
  const size = Number(batch);
  const valid = batch.trim() !== "" && Number.isInteger(size) && size >= 1 && size <= 20;
  const enabled =
    controls.generationEnabled && controls.backfillEnabled && !controls.backfillPaused;
  const scan = mode === "DB_MANIFEST_MISSING" || mode === "VERIFIED_HLS_MISSING_DB";
  const action: AdaptiveAction = {
    kind: "recovery",
    mode,
    batchSize: size,
    ...(scan && continuation?.hasMore && continuation.cursor
      ? { cursor: continuation.cursor }
      : {}),
  };
  return (
    <details
      className={styles.operatorSection}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{text("Advanced media maintenance", "صيانة الوسائط المتقدمة")}</summary>
      <p>
        {text(
          "Run one reviewed batch at a time. Existing worker and storage limits still apply.",
          "نفّذ دفعة واحدة بعد مراجعتها. تبقى حدود المعالجة والتخزين سارية.",
        )}
      </p>
      {superadmin ? (
        <div className={styles.actions}>
          <button
            className={styles.button}
            type="button"
            disabled={busy}
            onClick={() => select({ kind: controls.backfillPaused ? "resume" : "pause" })}
          >
            {adaptiveLabel({ kind: controls.backfillPaused ? "resume" : "pause" }, ar)}
          </button>
        </div>
      ) : null}
      {!enabled ? (
        <p className={styles.muted}>
          {text(
            "Catalog conversion is disabled or paused. Expired processing recovery is still available.",
            "تحويل المحتوى معطّل أو موقوف. استعادة المعالجة منتهية المهلة ما زالت متاحة.",
          )}
        </p>
      ) : null}
      <div className={styles.toolbar}>
        <label htmlFor="adaptive-batch">
          {text("Maximum items per action", "الحد الأقصى للعناصر لكل إجراء")}
        </label>
        <input
          id="adaptive-batch"
          type="number"
          min={1}
          max={20}
          step={1}
          inputMode="numeric"
          value={batch}
          disabled={busy}
          aria-invalid={!valid}
          aria-describedby="adaptive-batch-help"
          onChange={(event) => setBatch(event.target.value)}
        />
        <p id="adaptive-batch-help" className={styles.muted}>
          {text(
            "Choose 1–20. Actual queueing also depends on available capacity and configured limits.",
            "اختر من 1 إلى 20. العدد الفعلي يتوقف أيضًا على السعة المتاحة والحدود المضبوطة.",
          )}
        </p>
      </div>
      <button
        className={styles.button}
        type="button"
        disabled={busy || !valid || !enabled}
        onClick={() => select({ kind: "backfill", batchSize: size })}
      >
        {adaptiveLabel({ kind: "backfill", batchSize: size }, ar)}
      </button>
      <h3>{text("Recovery", "الاستعادة")}</h3>
      <div className={styles.toolbar}>
        <label htmlFor="adaptive-recovery">{text("Recovery action", "إجراء الاستعادة")}</label>
        <select
          id="adaptive-recovery"
          value={mode}
          disabled={busy}
          onChange={(event) => setMode(event.target.value as RecoveryMode)}
        >
          {recoveryModes.map((value) => (
            <option key={value} value={value}>
              {adaptiveLabel({ kind: "recovery", mode: value, batchSize: size }, ar)}
            </option>
          ))}
        </select>
      </div>
      <p>{adaptiveDescription(action, ar)}</p>
      {scan && continuation ? (
        <p role="status">
          {continuation.hasMore
            ? text(
                "A scan is in progress. Continue when capacity is available.",
                "الفحص قيد الاستكمال. تابع عند توفر السعة.",
              )
            : text(
                "The previous scan is complete. You can start a new scan.",
                "اكتمل الفحص السابق. يمكنك بدء فحص جديد.",
              )}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button
          className={styles.button}
          type="button"
          disabled={busy || !valid || (mode !== "STALE_PROCESSING" && !enabled)}
          onClick={() => select(action)}
        >
          {scan && continuation?.hasMore
            ? text("Continue scan", "استكمال الفحص")
            : text("Review recovery", "مراجعة الاستعادة")}
        </button>
        {scan && continuation ? (
          <button className={styles.button} type="button" disabled={busy} onClick={resetScan}>
            {text("Reset scan position", "إعادة موضع الفحص للبداية")}
          </button>
        ) : null}
      </div>
    </details>
  );
}
