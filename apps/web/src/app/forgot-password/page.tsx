"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl } from "@/lib/api";
import { recoveryErrorKey } from "@/lib/auth-recovery";
import type { TranslationKey } from "@/lib/i18n/translator";

import styles from "../auth-form.module.css";
import recoveryStyles from "../auth-recovery.module.css";

export default function ForgotPasswordPage() {
  const { href, t } = useI18n();
  const [error, setError] = useState<{ key: TranslationKey; field?: "email" } | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const emailInput = useRef<HTMLInputElement | null>(null);
  const feedback = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const clear = () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      pending.current = false;
      setSubmitting(false);
      setSent(false);
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
    if (error?.field === "email") emailInput.current?.focus();
    else if (error || sent) feedback.current?.focus();
  }, [error, sent]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    if (!emailInput.current?.validity.valid) {
      setError({ key: "authRecovery.emailInvalid", field: "email" });
      return;
    }
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    if (email.length > 320) {
      setError({ key: "authRecovery.emailInvalid", field: "email" });
      return;
    }
    pending.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${apiBaseUrl}/auth/forgot-password`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setError({
          key: recoveryErrorKey(response.status, "forgot"),
          ...(response.status === 400 ? { field: "email" as const } : {}),
        });
        return;
      }
      form.current?.reset();
      setSent(true);
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
        <h1 id="recovery-title">{t("authRecovery.forgotTitle")}</h1>
        <p className={styles.intro}>{t("authRecovery.forgotIntro")}</p>

        {sent ? (
          <p ref={feedback} className={styles.intro} role="status" tabIndex={-1}>
            {t("authRecovery.sent")}
          </p>
        ) : (
          <form
            ref={form}
            aria-busy={submitting}
            className={styles.form}
            noValidate
            onSubmit={submit}
          >
            <label htmlFor="recovery-email">
              <span>{t("auth.email")}</span>
              <input
                ref={emailInput}
                aria-describedby={error?.field === "email" ? "recovery-error" : undefined}
                aria-invalid={error?.field === "email" || undefined}
                autoComplete="email"
                dir="ltr"
                disabled={submitting}
                id="recovery-email"
                inputMode="email"
                maxLength={320}
                name="email"
                placeholder={t("auth.emailPlaceholder")}
                required
                type="email"
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
              {submitting ? t("authRecovery.sending") : t("authRecovery.send")}
            </button>
          </form>
        )}
        <p className={styles.switcher}>
          <Link href={href("/login")}>{t("authRecovery.backToSignIn")}</Link>
        </p>
      </section>
    </main>
  );
}
