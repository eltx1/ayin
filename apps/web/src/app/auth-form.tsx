"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { MfaEnrollmentSecret, MfaRecoveryCodes } from "@/components/auth/mfa-secrets";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { requestMfa } from "@/lib/account-mfa";
import { mustRestartMfa, normalizeLoginMfaCode } from "@/lib/login-mfa";

import styles from "./auth-form.module.css";

type Mode = "login" | "register";

interface MfaChallenge {
  challengeToken: string;
  enrollmentRequired: boolean;
  mfaRequired: true;
  expiresAt?: string;
}

interface Enrollment {
  enrollmentToken: string;
  qrCodeDataUrl: string;
  secret: string;
  expiresAt: string;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const { href, t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const pending = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);

  const restartLogin = useCallback((message: string | null = null) => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    pending.current = false;
    setSubmitting(false);
    setChallenge(null);
    setEnrollment(null);
    setRecoveryCodes(null);
    setError(message);
    form.current?.reset();
  }, []);

  useEffect(() => {
    const clear = () => restartLogin();
    window.addEventListener("pagehide", clear);
    return () => {
      activeRequest.current?.abort();
      window.removeEventListener("pagehide", clear);
    };
  }, [restartLogin]);

  useEffect(() => {
    if (recoveryCodes) return;
    const expiresAt = enrollment?.expiresAt ?? challenge?.expiresAt;
    if (!expiresAt) return;
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline)) return;
    const expire = () => {
      if (Date.now() >= deadline) restartLogin(t("auth.mfaRestartRequired"));
    };
    // Mobile browsers suspend timers while the authenticator is in front.
    const timer = window.setTimeout(expire, Math.max(0, deadline - Date.now()));
    document.addEventListener("visibilitychange", expire);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [challenge?.expiresAt, enrollment?.expiresAt, recoveryCodes, restartLogin, t]);

  function finishLogin() {
    setRecoveryCodes(null);
    setEnrollment(null);
    setChallenge(null);
    router.push(href("/"));
    router.refresh();
  }

  async function startEnrollment(challengeToken: string, signal: AbortSignal) {
    return (await requestMfa("enrollment/start", signal, { challengeToken })) as Enrollment;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setError(null);
    setSubmitting(true);
    const data = new FormData(event.currentTarget);
    const payload =
      mode === "register"
        ? {
            name: String(data.get("name") ?? ""),
            email: String(data.get("email") ?? ""),
            password: String(data.get("password") ?? ""),
          }
        : {
            email: String(data.get("email") ?? ""),
            password: String(data.get("password") ?? ""),
          };

    try {
      const response = await fetch(
        `${apiBaseUrl}/auth/${mode === "register" ? "register" : "login"}`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }
      const result = (await response.json()) as Partial<MfaChallenge>;
      if (controller.signal.aborted) return;
      if (result.mfaRequired && result.challengeToken) {
        const nextChallenge = result as MfaChallenge;
        const nextEnrollment = nextChallenge.enrollmentRequired
          ? await startEnrollment(nextChallenge.challengeToken, controller.signal)
          : null;
        if (controller.signal.aborted) return;
        // Enter the enrollment screen only after setup has succeeded. A failed
        // start must never render a verification form for an enrollment token.
        setEnrollment(nextEnrollment);
        setChallenge(nextChallenge);
        return;
      }
      router.push(href(mode === "register" ? "/?welcome=1" : "/"));
      router.refresh();
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (mustRestartMfa(cause)) restartLogin(t("auth.mfaRestartRequired"));
        else setError(cause instanceof Error ? cause.message : t("auth.connectionError"));
      }
    } finally {
      if (activeRequest.current === controller) {
        pending.current = false;
        setSubmitting(false);
      }
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || pending.current) return;
    pending.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setError(null);
    setSubmitting(true);
    const value = normalizeLoginMfaCode(
      String(new FormData(event.currentTarget).get("mfaCode") ?? ""),
    );
    event.currentTarget.reset();

    try {
      const result = (await requestMfa(
        enrollment ? "enrollment/verify" : "challenge",
        controller.signal,
        enrollment
          ? { enrollmentToken: enrollment.enrollmentToken, code: value }
          : {
              challengeToken: challenge.challengeToken,
              ...(/^\d{6}$/.test(value) ? { code: value } : { recoveryCode: value }),
            },
      )) as { recoveryCodes?: string[] };
      if (controller.signal.aborted) return;
      if (result.recoveryCodes?.length) {
        setEnrollment(null);
        setRecoveryCodes(result.recoveryCodes);
        return;
      }
      finishLogin();
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (mustRestartMfa(cause)) restartLogin(t("auth.mfaRestartRequired"));
        else
          setError(
            cause instanceof Error && cause.name !== "TypeError"
              ? cause.message
              : t("auth.mfaConnectionError"),
          );
      }
    } finally {
      if (activeRequest.current === controller) {
        pending.current = false;
        setSubmitting(false);
      }
    }
  }

  const registering = mode === "register";

  return (
    <main className={styles.shell}>
      <Link className={styles.brand} href={href("/")} aria-label={t("shell.homeAria")}>
        AYIN
      </Link>
      <section className={styles.card}>
        {recoveryCodes ? (
          <>
            <p className={styles.eyebrow}>{t("auth.mfaEnabled")}</p>
            <MfaRecoveryCodes codes={recoveryCodes} onDone={finishLogin} headingLevel={1} />
          </>
        ) : challenge ? (
          <>
            <p className={styles.eyebrow}>{t("auth.adminSecurity")}</p>
            <h1>{enrollment ? t("auth.secureAdmin") : t("auth.twoStep")}</h1>
            <p className={styles.intro}>{enrollment ? t("auth.scanQr") : t("auth.enterCode")}</p>
            {enrollment ? <p className={styles.intro}>{t("auth.adminMfaPolicy")}</p> : null}
            {enrollment ? (
              <MfaEnrollmentSecret enrollment={enrollment} label={t("auth.secureAdmin")} />
            ) : null}
            <form ref={form} className={styles.form} onSubmit={submitMfa}>
              <label>
                <span>
                  {enrollment ? t("auth.authenticationCode") : t("auth.authenticationRecoveryCode")}
                </span>
                <input
                  autoComplete="one-time-code"
                  dir="ltr"
                  inputMode={enrollment ? "numeric" : "text"}
                  name="mfaCode"
                  maxLength={32}
                  placeholder={enrollment ? "000000" : "000000 / recovery code"}
                  required
                />
              </label>
              {error ? (
                <p className={styles.error} dir="auto" role="alert">
                  {error}
                </p>
              ) : null}
              <button className={styles.primary} disabled={submitting} type="submit">
                {submitting
                  ? t("auth.verifying")
                  : enrollment
                    ? t("auth.enableMfa")
                    : t("auth.verify")}
              </button>
              <button className={styles.secondary} onClick={() => restartLogin()} type="button">
                {t("auth.restartSignIn")}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>
              {registering ? t("auth.joinAyin") : t("auth.welcomeBack")}
            </p>
            <h1>{registering ? t("auth.createTitle") : t("auth.signInTitle")}</h1>
            <p className={styles.intro}>
              {registering ? t("auth.registerIntro") : t("auth.signInIntro")}
            </p>
            <form ref={form} className={styles.form} onSubmit={submit}>
              {registering ? (
                <label>
                  <span>{t("auth.name")}</span>
                  <input
                    autoComplete="name"
                    dir="auto"
                    maxLength={120}
                    minLength={2}
                    name="name"
                    placeholder={t("auth.namePlaceholder")}
                    required
                  />
                </label>
              ) : null}
              <label>
                <span>{t("auth.email")}</span>
                <input
                  autoComplete="email"
                  dir="ltr"
                  inputMode="email"
                  name="email"
                  placeholder={t("auth.emailPlaceholder")}
                  required
                  type="email"
                />
              </label>
              <label>
                <span>{t("auth.password")}</span>
                <input
                  autoComplete={registering ? "new-password" : "current-password"}
                  dir="ltr"
                  maxLength={128}
                  minLength={registering ? 10 : undefined}
                  name="password"
                  placeholder={
                    registering ? t("auth.newPasswordPlaceholder") : t("auth.passwordPlaceholder")
                  }
                  required
                  type="password"
                />
              </label>
              {!registering ? (
                <p className={styles.switcher}>
                  <Link href={href("/forgot-password")}>{t("auth.forgotPassword")}</Link>
                </p>
              ) : null}
              {error ? (
                <p className={styles.error} dir="auto" role="alert">
                  {error}
                </p>
              ) : null}
              {registering ? (
                <p className={styles.switcher}>
                  {t("auth.legalPrefix")}{" "}
                  <Link href={href("/terms")}>{t("auth.termsOfService")}</Link>،{" "}
                  <Link href={href("/creator-terms")}>{t("auth.creatorRightsTerms")}</Link>،{" "}
                  <Link href={href("/community-guidelines")}>{t("shell.communityGuidelines")}</Link>
                  ، {t("auth.andAcknowledge")}{" "}
                  <Link href={href("/privacy")}>{t("auth.privacyPolicy")}</Link> و{" "}
                  <Link href={href("/cookies")}>{t("auth.cookiesNotice")}</Link>.
                </p>
              ) : null}
              <button className={styles.primary} disabled={submitting} type="submit">
                {submitting
                  ? t("auth.pleaseWait")
                  : registering
                    ? t("auth.createAccount")
                    : t("auth.signIn")}
              </button>
            </form>
            <p className={styles.switcher}>
              {registering ? t("auth.alreadyHaveAyin") : t("auth.newToAyin")}{" "}
              <Link href={href(registering ? "/login" : "/register")}>
                {registering ? t("auth.signIn") : t("auth.createAccount")}
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
