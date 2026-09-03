"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { apiBaseUrl, readApiError } from "@/lib/api";

import styles from "../auth-form.module.css";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/forgot-password`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }

      setSent(true);
    } catch {
      setError("AYIN could not be reached. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <Link className={styles.brand} href="/" aria-label="AYIN home">
        AYIN
      </Link>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Account recovery</p>
        <h1>Reset your password</h1>
        <p className={styles.intro}>
          Enter your AYIN email address. If an active account exists, we&apos;ll send a secure reset link.
        </p>

        {sent ? (
          <>
            <p className={styles.intro} role="status">
              Check your inbox. If an AYIN account exists for that address, a password reset link has been sent.
            </p>
            <p className={styles.switcher}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <form className={styles.form} onSubmit={submit}>
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

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            <button className={styles.primary} disabled={submitting} type="submit">
              {submitting ? "Please wait…" : "Send reset link"}
            </button>

            <p className={styles.switcher}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
