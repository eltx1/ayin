"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiBaseUrl, type AyinIdentity } from "@/lib/api";

import styles from "./page.module.css";

export function SessionPanel({ showWelcome }: { showWelcome: boolean }) {
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void fetch(`${apiBaseUrl}/auth/me`, { credentials: "include" })
      .then(async (response) => {
        if (!active || !response.ok) {
          return;
        }
        setIdentity((await response.json()) as AyinIdentity);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    await fetch(`${apiBaseUrl}/auth/logout`, { method: "POST", credentials: "include" }).catch(
      () => undefined,
    );
    setIdentity(null);
  }

  if (loading) {
    return <div className={styles.accountSlot} aria-hidden="true" />;
  }

  if (!identity) {
    return (
      <div className={styles.actions}>
        <Link className={styles.secondaryAction} href="/login">
          Sign in
        </Link>
        <Link className={styles.primaryAction} href="/register">
          Create AYIN
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.sessionCard}>
      {showWelcome ? (
        <p className={styles.readyMessage} role="status">
          Your AYIN channel and TV are ready.
        </p>
      ) : null}
      <p className={styles.signedIn}>Signed in as {identity.account.displayName}</p>
      <div className={styles.identityLine}>
        <span>@{identity.channel.handle}</span>
        <span aria-hidden="true">•</span>
        <span>{identity.creatorTv.name}</span>
      </div>
      <button className={styles.textButton} onClick={logout} type="button">
        Log out
      </button>
    </div>
  );
}
