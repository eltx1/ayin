"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl, readApiError } from "@/lib/api";

import styles from "./auth-form.module.css";

type Mode = "login" | "register";

interface MfaChallenge {
  challengeToken: string;
  enrollmentRequired: boolean;
  mfaRequired: true;
}

interface Enrollment {
  enrollmentToken: string;
  qrCodeDataUrl: string;
  secret: string;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const { href, t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  function finishLogin() {
    router.push(href("/"));
    router.refresh();
  }

  async function startEnrollment(challengeToken: string) {
    const response = await fetch(`${apiBaseUrl}/auth/mfa/enrollment/start`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeToken }),
    });
    if (!response.ok) throw new Error(await readApiError(response));
    setEnrollment((await response.json()) as Enrollment);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }
      const result = (await response.json()) as Partial<MfaChallenge>;
      if (result.mfaRequired && result.challengeToken) {
        const nextChallenge = result as MfaChallenge;
        setChallenge(nextChallenge);
        if (nextChallenge.enrollmentRequired) await startEnrollment(nextChallenge.challengeToken);
        return;
      }
      router.push(href(mode === "register" ? "/?welcome=1" : "/"));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("auth.connectionError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    setSubmitting(true);
    const value = String(new FormData(event.currentTarget).get("mfaCode") ?? "").trim();

    try {
      const response = await fetch(
        `${apiBaseUrl}/auth/mfa/${enrollment ? "enrollment/verify" : "challenge"}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            enrollment
              ? { enrollmentToken: enrollment.enrollmentToken, code: value }
              : {
                  challengeToken: challenge.challengeToken,
                  ...(/^\d{6}$/.test(value) ? { code: value } : { recoveryCode: value }),
                },
          ),
        },
      );
      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }
      const result = (await response.json()) as { recoveryCodes?: string[] };
      if (result.recoveryCodes?.length) {
        setRecoveryCodes(result.recoveryCodes);
        return;
      }
      finishLogin();
    } catch {
      setError(t("auth.connectionError"));
    } finally {
      setSubmitting(false);
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
            <h1>{t("auth.recoveryTitle")}</h1>
            <p className={styles.intro}>{t("auth.recoveryIntro")}</p>
            <ul className={styles.recoveryCodes} aria-label={t("auth.recoveryTitle")} dir="ltr">
              {recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <button className={styles.primary} onClick={finishLogin} type="button">
              {t("auth.savedCodes")}
            </button>
          </>
        ) : challenge ? (
          <>
            <p className={styles.eyebrow}>{t("auth.adminSecurity")}</p>
            <h1>{enrollment ? t("auth.secureAdmin") : t("auth.twoStep")}</h1>
            <p className={styles.intro}>{enrollment ? t("auth.scanQr") : t("auth.enterCode")}</p>
            {enrollment ? (
              <div className={styles.provisioning}>
                <Image
                  alt={t("auth.secureAdmin")}
                  height={240}
                  src={enrollment.qrCodeDataUrl}
                  unoptimized
                  width={240}
                />
                <details>
                  <summary>{t("auth.cannotScan")}</summary>
                  <p>{t("auth.manualKey")}</p>
                  <code dir="ltr">{enrollment.secret}</code>
                </details>
              </div>
            ) : null}
            <form className={styles.form} onSubmit={submitMfa}>
              <label>
                <span>
                  {enrollment ? t("auth.authenticationCode") : t("auth.authenticationRecoveryCode")}
                </span>
                <input
                  autoComplete="one-time-code"
                  dir="ltr"
                  inputMode={enrollment ? "numeric" : "text"}
                  name="mfaCode"
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
            <form className={styles.form} onSubmit={submit}>
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
