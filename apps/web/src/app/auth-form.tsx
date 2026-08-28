"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { apiBaseUrl, readApiError } from "@/lib/api";

import styles from "./auth-form.module.css";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

      router.push(mode === "register" ? "/?welcome=1" : "/");
      router.refresh();
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

          {error ? (
            <p className={styles.error} role="alert">
              {error}
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
      </section>
    </main>
  );
}
