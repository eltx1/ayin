"use client";

import { useEffect, useState, type FormEvent } from "react";

import styles from "@/app/(viewer)/account/account.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl, readApiError } from "@/lib/api";

const CONFIRMATION = "DELETE MY AYIN ACCOUNT";

interface DeletionRequest {
  id: string;
  state: "REQUESTED" | "GRACE_PERIOD" | "DEACTIVATED" | "ANONYMIZED" | "CANCELLED";
  requestedAt: string;
  graceEndsAt: string | null;
  deactivatedAt: string | null;
  anonymizedAt: string | null;
  cancelledAt: string | null;
  mediaCleanupQueuedAt: string | null;
  mediaCleanupCompletedAt: string | null;
}

interface PrivacyStatus {
  policy: {
    gracePeriodDays: number;
    deactivatedRecoveryHours: number;
    finalDatabaseState: "ANONYMIZED";
  };
  request: DeletionRequest | null;
}

async function readStatus(): Promise<PrivacyStatus> {
  const response = await fetch(`${apiBaseUrl}/privacy/deletion`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as PrivacyStatus;
}

export function AccountPrivacyControls() {
  const { formatDate, locale, t } = useI18n();
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dateLabel = (value: string | null) =>
    value ? formatDate(value, { dateStyle: "medium", timeStyle: "short" }) : "—";

  async function refresh() {
    setStatus(await readStatus());
  }

  useEffect(() => {
    let active = true;
    void readStatus().then(
      (nextStatus) => {
        if (active) setStatus(nextStatus);
      },
      (caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : t("account.privacyLoadError"));
      },
    );
    return () => {
      active = false;
    };
  }, [t]);

  async function downloadData() {
    setBusy("export");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/privacy/export`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? "ayin-data-export.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(t("account.exportReady"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("account.exportError"));
    } finally {
      setBusy("");
    }
  }

  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("delete");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/privacy/deletion`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: String(data.get("password") ?? ""),
          confirmation: String(data.get("confirmation") ?? ""),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      form.reset();
      await refresh();
      setMessage(t("account.deletionRequested"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("account.deletionRequestError"));
    } finally {
      setBusy("");
    }
  }

  async function cancelDeletion() {
    setBusy("cancel");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/privacy/deletion/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      await refresh();
      setMessage(t("account.deletionCancelled"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("account.cancelDeletionError"));
    } finally {
      setBusy("");
    }
  }

  const active = status?.request;
  const cancellable = active?.state === "REQUESTED" || active?.state === "GRACE_PERIOD";
  const graceDays = status?.policy.gracePeriodDays ?? 14;

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
          disabled={busy !== ""}
          onClick={() => void downloadData()}
          type="button"
        >
          {busy === "export" ? t("account.preparing") : t("account.downloadData")}
        </button>
      </div>

      {error ? (
        <p className={styles.error} dir="auto">
          {error}
        </p>
      ) : null}
      {message ? <p className={styles.success}>{message}</p> : null}

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
                disabled={busy !== ""}
                onClick={() => void cancelDeletion()}
                type="button"
              >
                {busy === "cancel" ? t("account.cancelling") : t("account.cancelDeletion")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

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

      {!active || active.state === "CANCELLED" ? (
        <form className={styles.passwordForm} onSubmit={(event) => void requestDeletion(event)}>
          <h3>{t("account.requestDeletion")}</h3>
          <label>
            <span>{t("account.currentPassword")}</span>
            <input
              autoComplete="current-password"
              dir="ltr"
              name="password"
              required
              type="password"
            />
          </label>
          <label>
            <span>{t("account.typeConfirmation", { confirmation: CONFIRMATION })}</span>
            <input autoComplete="off" dir="ltr" name="confirmation" required type="text" />
          </label>
          <p className={styles.muted}>
            {locale === "ar"
              ? "نزّل بياناتك أولًا إذا أردت الاحتفاظ بنسخة. المتابعة تبدأ فترة السماح ولا تمحو فورًا السجلات المالية أو الأمنية أو سجلات الإشراف والتدقيق المطلوب الاحتفاظ بها."
              : "Download your data first if you want a copy. Continuing starts the grace period; it does not immediately erase retained financial, security, moderation or audit history."}
          </p>
          <button className={styles.dangerButton} disabled={busy !== ""} type="submit">
            {busy === "delete" ? t("account.requesting") : t("account.requestDeletion")}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function deletionStateLabel(state: DeletionRequest["state"], locale: "en" | "ar") {
  if (locale !== "ar") return state.replaceAll("_", " ");
  const labels: Record<DeletionRequest["state"], string> = {
    REQUESTED: "تم الطلب",
    GRACE_PERIOD: "فترة السماح",
    DEACTIVATED: "تم التعطيل",
    ANONYMIZED: "أزيلت بيانات الهوية",
    CANCELLED: "تم الإلغاء",
  };
  return labels[state];
}
