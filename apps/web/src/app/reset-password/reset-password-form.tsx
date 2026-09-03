"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { apiBaseUrl, readApiError } from "@/lib/api";

import styles from "../auth-form.module.css";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");

    if (password !== confirmation) {
      setError("Passwords do not match.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, token }),
      });

      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }

      setReset(true);
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
        <h1>Choose a new password</h1>

        {reset ? (
          <>
            <p className={styles.intro} role="status">
              Your password has been reset. You can now sign in with the new password.
            </p>
            <p className={styles.switcher}>
              <Link href="/login">Sign in to AYIN</Link>
            </p>
          </>
        ) : token ? (
          <form className={styles.form} onSubmit={submit}>
            <label>
              <span>New password</span>
              <input
                autoComplete="new-password"
                maxLength={128}
                minLength={10}
                name="password"
                placeholder="At least 10 characters"
                required
                type="password"
              />
            </label>
            <label>
              <span>Confirm new password</span>
              <input
                autoComplete="new-password"
                maxLength={128}
                minLength={10}
                name="confirmation"
                placeholder="Repeat your new password"
                required
                type="password"
              />
            </label>

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            <button className={styles.primary} disabled={submitting} type="submit">
              {submitting ? "Please wait…" : "Reset password"}
            </button>
          </form>
        ) : (
          <>
            <p className={styles.error} role="alert">
              This password reset link is incomplete or invalid.
            </p>
            <p className={styles.switcher}>
              <Link href="/forgot-password">Request a new reset link</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
