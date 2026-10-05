"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "@/app/(viewer)/account/account.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { AccountScopeError, requestAccountScope } from "@/lib/account-scope";
import {
  MAX_PRIVACY_EXPORT_BYTES,
  parsePrivacyStatus,
  parseDeletionAcknowledgment,
  parseCancellationAcknowledgment,
  parsePrivacyExport,
  type PrivacyStatus,
  type DeletionRequest,
} from "@/lib/account-privacy-response";

const CONFIRMATION = "DELETE MY AYIN ACCOUNT";

import { useAccountFreeze, useAccountWorkspace } from "./account-workspace";

export function AccountPrivacyControls() {
  const { formatDate, locale, t } = useI18n();
  const binding = useAccountWorkspace();
  const pending = useRef(false);
  const account = useRef<string | undefined>(undefined);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const privateBody = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(true);
  const [concealed, setConcealed] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dateLabel = (value: string | null) =>
    value ? formatDate(value, { dateStyle: "medium", timeStyle: "short" }) : "—";

  useAccountFreeze(binding, () => conceal());
  function conceal(clearAccount = false) {
    if (clearAccount && binding) {
      binding.freeze();
      return;
    }
    if (privateBody.current) privateBody.current.hidden = true;
    formRef.current?.reset();
    controller.current?.abort();
    epoch.current += 1;
    pending.current = false;
    if (clearAccount) account.current = undefined;
    setConcealed(true);
    setStatus(null);
    setMessage("");
    setNeedsReview(true);
    setLoading(false);
    setBusy("");
  }
  const scopeLost = (cause: unknown) =>
    cause instanceof AccountScopeError &&
    (cause.code === "ACCOUNT_CHANGED" || cause.status === 401);
  async function refresh(signal: AbortSignal, revision: number) {
    const next = await requestAccountScope("/privacy/deletion", "GET", parsePrivacyStatus, {
      expectedAccountId: binding?.expectedAccount() ?? account.current,
      signal,
      maxResponseBytes: 256 * 1024,
    });
    if (signal.aborted || revision !== epoch.current) return;
    account.current = next.accountId;
    setStatus(next.value);
    setConcealed(false);
  }
  async function review() {
    if (pending.current) return;
    pending.current = true;
    const revision = epoch.current,
      active = new AbortController();
    controller.current = active;
    setBusy("read");
    setLoading(true);
    try {
      await refresh(active.signal, revision);
      if (revision !== epoch.current || active.signal.aborted) return;
      setNeedsReview(false);
      setError("");
    } catch (cause) {
      if (revision !== epoch.current || active.signal.aborted) return;
      if (scopeLost(cause)) conceal(true);
      else {
        setStatus(null);
        setNeedsReview(true);
      }
      setError(t("account.privacyLoadError"));
    } finally {
      if (revision === epoch.current) {
        pending.current = false;
        setBusy("");
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    let mounted = true;
    const initial = epoch.current;
    void Promise.resolve().then(() => {
      if (mounted && epoch.current === initial) void review();
    });
    const hide = () => {
      conceal();
      setError(copy("Read privacy status to continue.", "اقرأ حالة الخصوصية للمتابعة."));
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted = false;
      controller.current?.abort();
      epoch.current += 1;
      pending.current = false;
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
    // Lifecycle recovery is explicit; mount performs one verified read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function command<T>(
    key: string,
    path: string,
    decode: (value: unknown) => T,
    success: string,
    body?: Record<string, unknown>,
  ) {
    if (pending.current || loading || needsReview || !status || !account.current) return;
    pending.current = true;
    const revision = epoch.current,
      active = new AbortController();
    controller.current = active;
    setBusy(key);
    setMessage("");
    setError("");
    try {
      await requestAccountScope(
        path,
        "POST",
        decode,
        {
          expectedAccountId: binding?.expectedAccount() ?? account.current,
          signal: active.signal,
          maxResponseBytes: 256 * 1024,
        },
        body,
      );
      if (revision !== epoch.current || active.signal.aborted) return;
      formRef.current?.reset();
      setMessage(success);
      try {
        await refresh(active.signal, revision);
      } catch (cause) {
        if (revision !== epoch.current || active.signal.aborted) return;
        if (scopeLost(cause)) conceal(true);
        else {
          setStatus(null);
          setNeedsReview(true);
        }
        setError(
          copy(
            "The operation was confirmed. The current privacy status could not be refreshed. Read privacy status before another operation.",
            "تم تأكيد العملية، لكن تعذّر تحديث حالة الخصوصية الحالية. اقرأ الحالة قبل عملية أخرى.",
          ),
        );
      }
    } catch (cause) {
      if (revision !== epoch.current || active.signal.aborted) return;
      if (scopeLost(cause)) conceal(true);
      else {
        formRef.current?.reset();
        setStatus(null);
        setNeedsReview(true);
      }
      setError(
        scopeLost(cause)
          ? copy(
              "The account changed. Read privacy status before proceeding.",
              "تغيّر الحساب. اقرأ حالة الخصوصية قبل المتابعة.",
            )
          : copy(
              "The operation response was not confirmed. Read privacy status before proceeding; the request will not be replayed.",
              "لم يتم تأكيد رد العملية. اقرأ حالة الخصوصية قبل المتابعة؛ لن يُعاد إرسال الطلب.",
            ),
      );
    } finally {
      if (revision === epoch.current) {
        pending.current = false;
        setBusy("");
      }
    }
  }
  async function downloadData() {
    if (pending.current || loading || needsReview || !status || !account.current) return;
    pending.current = true;
    const revision = epoch.current,
      active = new AbortController(),
      expected = account.current;
    controller.current = active;
    setBusy("export");
    setError("");
    setMessage("");
    try {
      const result = await requestAccountScope(
        "/privacy/export",
        "GET",
        (value) => parsePrivacyExport(value, expected),
        {
          expectedAccountId: expected,
          signal: active.signal,
          maxResponseBytes: MAX_PRIVACY_EXPORT_BYTES,
        },
      );
      if (revision !== epoch.current || active.signal.aborted) return;
      const blob = new Blob([result.value.text], { type: "application/json" });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      try {
        link.href = url;
        link.download = result.value.filename;
        document.body.appendChild(link);
        link.click();
        setMessage(t("account.exportReady"));
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (cause) {
      if (revision !== epoch.current || active.signal.aborted) return;
      if (scopeLost(cause)) conceal(true);
      setError(
        cause instanceof AccountScopeError && cause.code === "RESPONSE_TOO_LARGE"
          ? copy(
              "The export exceeds the 10 MB download limit. No partial file was downloaded.",
              "يتجاوز ملف البيانات حد التنزيل البالغ 10 ميجابايت. لم يُنزّل ملف جزئي.",
            )
          : t("account.exportError"),
      );
    } finally {
      if (revision === epoch.current) {
        pending.current = false;
        setBusy("");
      }
    }
  }
  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await command(
      "delete",
      "/privacy/deletion",
      parseDeletionAcknowledgment,
      t("account.deletionRequested"),
      {
        password: String(data.get("password") ?? ""),
        confirmation: String(data.get("confirmation") ?? ""),
      },
    );
  }
  async function cancelDeletion() {
    await command(
      "cancel",
      "/privacy/deletion/cancel",
      parseCancellationAcknowledgment,
      t("account.deletionCancelled"),
    );
  }

  const active = status?.request;
  const cancellable = active?.state === "REQUESTED" || active?.state === "GRACE_PERIOD";
  const graceDays = status?.policy.gracePeriodDays;

  return (
    <section className={styles.securityCard} aria-labelledby="privacy-data-title">
      <div className={styles.securityHeading}>
        <div>
          <span className={styles.eyebrow}>{t("account.privacyEyebrow")}</span>
          <h2 id="privacy-data-title">{t("account.privacyTitle")}</h2>
          <p>{t("account.privacyDescription")}</p>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={busy !== "" || loading || needsReview || !status}
          onClick={() => void downloadData()}
          type="button"
        >
          {busy === "export" ? t("account.preparing") : t("account.downloadData")}
        </button>
      </div>

      <button
        className={styles.secondaryButton}
        type="button"
        disabled={loading || busy !== ""}
        onClick={() => void review()}
      >
        {copy("Read privacy status", "قراءة حالة الخصوصية")}
      </button>
      {loading ? (
        <p role="status">{copy("Reading privacy status…", "جارٍ قراءة حالة الخصوصية…")}</p>
      ) : null}
      {error ? (
        <p className={styles.error} dir="auto" role="alert">
          {error}
        </p>
      ) : null}
      <div
        ref={privateBody}
        className={styles.sessionPrivate}
        hidden={concealed}
        data-private-account-privacy="true"
      >
        {message ? (
          <p className={styles.success} role="status">
            {message}
          </p>
        ) : null}

        {active ? (
          <div className={styles.sessionGroup}>
            <h3>{t("account.deletionStatus")}</h3>
            <div className={styles.sessionRow}>
              <div>
                <strong dir="auto">{deletionStateLabel(active.state, locale)}</strong>
                <p>{t("account.requestedAt", { date: dateLabel(active.requestedAt) })}</p>
                <small>
                  {t("account.graceDeactivated", {
                    grace: dateLabel(active.graceEndsAt),
                    deactivated: dateLabel(active.deactivatedAt),
                  })}
                </small>
              </div>
              {cancellable ? (
                <button
                  className={styles.secondaryButton}
                  disabled={busy !== "" || loading || needsReview || !status}
                  onClick={() => void cancelDeletion()}
                  type="button"
                >
                  {busy === "cancel" ? t("account.cancelling") : t("account.cancelDeletion")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {status ? (
          <div className={styles.sessionGroup}>
            <h3>{t("account.deletionDoesTitle")}</h3>
            <p className={styles.muted}>
              {locale === "ar"
                ? `يمنح AYIN فترة سماح مدتها ${graceDays} يومًا. بعد انتهائها يُعطّل الحساب وتتوقف الجلسات. وبعد نافذة الاسترداد التقنية الإضافية تُزال هوية البيانات، ويُسحب محتوى صانع المحتوى من النشر، وتُدرج ملفات الوسائط للحذف غير المتزامن.`
                : `AYIN uses a ${graceDays}-day grace period. After it ends, the account is deactivated and sessions stop working. After the additional technical recovery window, identity data is anonymized, creator content is removed from publication, and media objects are queued for asynchronous deletion.`}
            </p>
            <p className={styles.muted}>
              {locale === "ar"
                ? "قد تبقى سجلات المحاسبة المالية وأدلة الاحتيال والأمان والإشراف وسجلات التدقيق عندما يؤدي حذفها إلى الإخلال بهذه السجلات، مع إزالة بيانات الهوية حيثما كان ذلك مناسبًا. يصف هذا السلوك التقني المطبق في AYIN ولا يُعد ادعاءً بالامتثال القانوني أو بيانًا شاملًا لمتطلبات الاحتفاظ في كل ولاية قضائية."
                : "Financial accounting records, fraud/security evidence, moderation evidence and audit records may remain where deleting them would break those records; identity fields are anonymized where appropriate. This describes AYIN's implemented technical behavior and is not a claim of legal compliance or a statement of every jurisdiction's retention requirements."}
            </p>
          </div>
        ) : null}

        {status && (!active || active.state === "CANCELLED") ? (
          <form
            ref={formRef}
            className={`${styles.passwordForm} ${styles.privacyDeletionForm}`}
            onSubmit={(event) => void requestDeletion(event)}
          >
            <h3>{t("account.requestDeletion")}</h3>
            <label>
              <span>{t("account.currentPassword")}</span>
              <input
                disabled={busy !== "" || loading || needsReview}
                autoComplete="current-password"
                dir="ltr"
                name="password"
                required
                type="password"
              />
            </label>
            <label>
              <span>{t("account.typeConfirmation", { confirmation: CONFIRMATION })}</span>
              <input
                disabled={busy !== "" || loading || needsReview}
                autoComplete="off"
                dir="ltr"
                name="confirmation"
                required
                type="text"
              />
            </label>
            <p className={styles.muted}>
              {locale === "ar"
                ? "نزّل بياناتك أولًا إذا أردت الاحتفاظ بنسخة. المتابعة تبدأ فترة السماح ولا تمحو فورًا السجلات المالية أو الأمنية أو سجلات الإشراف والتدقيق المطلوب الاحتفاظ بها."
                : "Download your data first if you want a copy. Continuing starts the grace period; it does not immediately erase retained financial, security, moderation or audit history."}
            </p>
            <button
              className={styles.dangerButton}
              disabled={busy !== "" || loading || needsReview || !status}
              type="submit"
            >
              {busy === "delete" ? t("account.requesting") : t("account.requestDeletion")}
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function deletionStateLabel(state: DeletionRequest["state"], locale: "en" | "ar") {
  if (locale !== "ar") {
    const labels: Record<DeletionRequest["state"], string> = {
      REQUESTED: "Deletion requested",
      GRACE_PERIOD: "Grace period",
      DEACTIVATED: "Account deactivated",
      ANONYMIZED: "Identity anonymized",
      CANCELLED: "Deletion cancelled",
    };
    return labels[state];
  }
  const labels: Record<DeletionRequest["state"], string> = {
    REQUESTED: "تم الطلب",
    GRACE_PERIOD: "فترة السماح",
    DEACTIVATED: "تم التعطيل",
    ANONYMIZED: "أزيلت بيانات الهوية",
    CANCELLED: "تم الإلغاء",
  };
  return labels[state];
}
