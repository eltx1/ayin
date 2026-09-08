"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  function finishLogin() {
    router.push("/");
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
      router.push(mode === "register" ? "/?welcome=1" : "/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "AYIN could not be reached. Please try again.",
      );
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
      setError("AYIN could not be reached. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const registering = mode === "register";

  return (
    <main className={styles.shell}>
      <Link className={styles.brand} href="/" aria-label="AYIN home">
        AYIN
      </Link>
      <section className={styles.card}>
        {recoveryCodes ? (
          <>
            <p className={styles.eyebrow}>MFA enabled</p>
            <h1>Save your recovery codes</h1>
            <p className={styles.intro}>
              Store these one-time codes in a password manager. AYIN will not show them again.
            </p>
            <ul className={styles.recoveryCodes} aria-label="Recovery codes">
              {recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <button className={styles.primary} onClick={finishLogin} type="button">
              I have saved these codes
            </button>
          </>
        ) : challenge ? (
          <>
            <p className={styles.eyebrow}>Administrator security</p>
            <h1>{enrollment ? "Secure your admin account" : "Two-step verification"}</h1>
            <p className={styles.intro}>
              {enrollment
                ? "Scan this QR code with any standards-compatible authenticator, then enter its six-digit code."
                : "Enter the current code from your authenticator, or use a recovery code."}
            </p>
            {enrollment ? (
              <div className={styles.provisioning}>
                {/* The data URL is generated by the API from the one-time provisioning URI. */}
                <Image
                  alt="AYIN authenticator setup QR code"
                  height={240}
                  src={enrollment.qrCodeDataUrl}
                  unoptimized
                  width={240}
                />
                <details>
                  <summary>Cannot scan the QR code?</summary>
                  <p>Enter this setup key manually. It is shown only during enrollment.</p>
                  <code>{enrollment.secret}</code>
                </details>
              </div>
            ) : null}
            <form className={styles.form} onSubmit={submitMfa}>
              <label>
                <span>
                  {enrollment ? "Authentication code" : "Authentication or recovery code"}
                </span>
                <input
                  autoComplete="one-time-code"
                  inputMode={enrollment ? "numeric" : "text"}
                  name="mfaCode"
                  placeholder={enrollment ? "000000" : "000000 or recovery code"}
                  required
                />
              </label>
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
              <button className={styles.primary} disabled={submitting} type="submit">
                {submitting ? "Verifying…" : enrollment ? "Enable MFA" : "Verify"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>{registering ? "Join AYIN" : "Welcome back"}</p>
            <h1>{registering ? "Create your AYIN" : "Sign in"}</h1>
            <p className={styles.intro}>
              {registering
                ? "One account. Your viewer profile, channel, Uploads playlist and Creator TV are created automatically."
                : "Continue watching, creating and managing your AYIN channel."}
            </p>
            <form className={styles.form} onSubmit={submit}>
              {registering ? (
                <label>
                  <span>Name</span>
                  <input
                    autoComplete="name"
                    maxLength={120}
                    minLength={2}
                    name="name"
                    placeholder="Your name or channel name"
                    required
                  />
                </label>
              ) : null}
              <label>
                <span>Email</span>
                <input
                  autoComplete="email"
                  inputMode="email"
                  name="email"
                  placeholder="you@example.com"
                  required
                  type="email"
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  autoComplete={registering ? "new-password" : "current-password"}
                  maxLength={128}
                  minLength={registering ? 10 : undefined}
                  name="password"
                  placeholder={registering ? "At least 10 characters" : "Your password"}
                  required
                  type="password"
                />
              </label>
              {!registering ? (
                <p className={styles.switcher}>
                  <Link href="/forgot-password">Forgot your password?</Link>
                </p>
              ) : null}
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
              {registering ? (
                <p className={styles.switcher}>
                  By creating an account, you agree to the{" "}
                  <Link href="/terms">Terms of Service</Link>,{" "}
                  <Link href="/creator-terms">Creator &amp; Content Rights Terms</Link> and{" "}
                  <Link href="/community-guidelines">Community Guidelines</Link>, and acknowledge
                  the <Link href="/privacy">Privacy Policy</Link> and{" "}
                  <Link href="/cookies">Cookie &amp; Advertising Notice</Link>.
                </p>
              ) : null}
              <button className={styles.primary} disabled={submitting} type="submit">
                {submitting ? "Please wait…" : registering ? "Create account" : "Sign in"}
              </button>
            </form>
            <p className={styles.switcher}>
              {registering ? "Already have AYIN?" : "New to AYIN?"}{" "}
              <Link href={registering ? "/login" : "/register"}>
                {registering ? "Sign in" : "Create account"}
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
