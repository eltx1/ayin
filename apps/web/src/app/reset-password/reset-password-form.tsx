"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl } from "@/lib/api";
import { recoveryErrorKey } from "@/lib/auth-recovery";
import type { TranslationKey } from "@/lib/i18n/translator";

import styles from "../auth-form.module.css";
import recoveryStyles from "../auth-recovery.module.css";

type ResetError = { key: TranslationKey; field?: "password" | "confirmation" };

export function ResetPasswordForm({ token }: { token: string }) {
  const { href, t } = useI18n();
  const [error, setError] = useState<ResetError | null>(null);
  const [reset, setReset] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);
  const confirmationInput = useRef<HTMLInputElement | null>(null);
  const feedback = useRef<HTMLParagraphElement | null>(null);
  const expired = error?.key === "authRecovery.expiredLink";

  useEffect(() => {
    const clear = () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      pending.current = false;
      setSubmitting(false);
      setReset(false);
      setError(null);
      form.current?.reset();
    };
    window.addEventListener("pagehide", clear);
    return () => {
      activeRequest.current?.abort();
      window.removeEventListener("pagehide", clear);
    };
  }, []);

  useEffect(() => {
    if (error?.field === "password") passwordInput.current?.focus();
    else if (error?.field === "confirmation") confirmationInput.current?.focus();
    else if (error || reset) feedback.current?.focus();
  }, [error, reset]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !token || expired) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");

    if (password.length < 10 || password.length > 128) {
      setError({ key: "authRecovery.passwordInvalid", field: "password" });
      return;
    }
    if (password !== confirmation) {
      setError({ key: "authRecovery.passwordMismatch", field: "confirmation" });
      return;
    }

    pending.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${apiBaseUrl}/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, token }),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401) form.current?.reset();
        setError({ key: recoveryErrorKey(response.status, "reset") });
        return;
      }
      form.current?.reset();
      setReset(true);
    } catch {
      if (!controller.signal.aborted) setError({ key: "auth.connectionError" });
    } finally {
      if (activeRequest.current === controller) {
        pending.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <main className={`${styles.shell} ${recoveryStyles.shell}`}>
      <Link
        className={`${styles.brand} ${recoveryStyles.brand}`}
        href={href("/")}
        aria-label={t("shell.homeAria")}
      >
        AYIN
      </Link>
      <section className={`${styles.card} ${recoveryStyles.card}`} aria-labelledby="recovery-title">
        <p className={`${styles.eyebrow} ${recoveryStyles.eyebrow}`}>{t("authRecovery.eyebrow")}</p>
        <h1 id="recovery-title">{t("authRecovery.resetTitle")}</h1>

        {reset ? (
          <p ref={feedback} className={styles.intro} role="status" tabIndex={-1}>
            {t("authRecovery.complete")}
          </p>
        ) : token && !expired ? (
          <form
            ref={form}
            aria-busy={submitting}
            className={styles.form}
            noValidate
            onSubmit={submit}
          >
            <p className={styles.intro}>{t("authRecovery.resetIntro")}</p>
            <label htmlFor="recovery-password">
              <span>{t("authRecovery.newPassword")}</span>
              <input
                ref={passwordInput}
                aria-describedby={`password-rules${error?.field === "password" ? " recovery-error" : ""}`}
                aria-invalid={error?.field === "password" || undefined}
                autoComplete="new-password"
                dir="ltr"
                disabled={submitting}
                id="recovery-password"
                maxLength={128}
                minLength={10}
                name="password"
                placeholder={t("auth.newPasswordPlaceholder")}
                required
                type="password"
              />
            </label>
            <p className={recoveryStyles.hint} id="password-rules">
              {t("authRecovery.passwordRules")}
            </p>
            <label htmlFor="recovery-confirmation">
              <span>{t("authRecovery.confirmPassword")}</span>
              <input
                ref={confirmationInput}
                aria-describedby={error?.field === "confirmation" ? "recovery-error" : undefined}
                aria-invalid={error?.field === "confirmation" || undefined}
                autoComplete="new-password"
                dir="ltr"
                disabled={submitting}
                id="recovery-confirmation"
                maxLength={128}
                minLength={10}
                name="confirmation"
                placeholder={t("authRecovery.confirmPlaceholder")}
                required
                type="password"
              />
            </label>

            {error ? (
              <p
                ref={feedback}
                className={styles.error}
                id="recovery-error"
                role="alert"
                tabIndex={-1}
              >
                {t(error.key)}
              </p>
            ) : null}

            <button
              className={`${styles.primary} ${recoveryStyles.primary}`}
              disabled={submitting}
              type="submit"
            >
              {submitting ? t("authRecovery.resetting") : t("authRecovery.reset")}
            </button>
          </form>
        ) : (
          <div className={recoveryStyles.feedback}>
            <p ref={feedback} className={styles.error} role="alert" tabIndex={-1}>
              {t(expired ? "authRecovery.expiredLink" : "authRecovery.invalidLink")}
            </p>
            <p className={styles.switcher}>
              <Link href={href("/forgot-password")}>{t("authRecovery.requestLink")}</Link>
            </p>
          </div>
        )}
        <p className={styles.switcher}>
          <Link href={href("/login")}>
            {t(reset ? "authRecovery.signIn" : "authRecovery.backToSignIn")}
          </Link>
        </p>
      </section>
    </main>
  );
}
