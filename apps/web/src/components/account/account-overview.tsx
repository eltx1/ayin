"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/app/(viewer)/account/account.module.css";
import { apiBaseUrl, type AyinIdentity, readApiError } from "@/lib/api";

const quickLinks = [
  ["My videos", "/studio/content", "Manage uploads, visibility and publishing."],
  ["Analytics", "/studio/analytics", "See audience and video performance."],
  ["Earnings & payouts", "/studio/monetization", "Review earnings, payout readiness and payment history."],
  ["My library", "/my-ayin", "Continue watching and revisit saved activity."],
  ["Notifications", "/notifications", "See updates about your channel and account."],
  ["Channel settings", "/channel/edit", "Update your public channel details."],
] as const;

export function AccountOverview() {
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/auth/me`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        setIdentity((await response.json()) as AyinIdentity);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Your account could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  if (loading) return <p className={styles.loading}>Loading your account…</p>;
  if (!identity) {
    return (
      <p className={styles.error}>
        {error || "Sign in to view your account."} <Link href="/login">Sign in</Link>
      </p>
    );
  }

  return (
    <>
      <section className={styles.identityCard} aria-label="Account identity">
        <div>
          <strong>{identity.account.displayName}</strong>
          <span>{identity.account.email}</span>
        </div>
        <Link className={styles.handle} href={`/c/${identity.channel.handle}`}>
          @{identity.channel.handle}
        </Link>
      </section>

      <nav className={styles.quickGrid} aria-label="Account shortcuts">
        {quickLinks.map(([label, href, description]) => (
          <Link className={styles.linkCard} href={href} key={href}>
            <strong>{label}</strong>
            <span>{description}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
