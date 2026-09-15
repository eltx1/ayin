"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/app/(viewer)/account/account.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl, type AyinIdentity, readApiError } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n/translator";

const quickLinks = [
  ["account.quick.videos", "/studio/content", "account.quick.videosDescription"],
  ["account.quick.analytics", "/studio/analytics", "account.quick.analyticsDescription"],
  ["account.quick.earnings", "/studio/monetization", "account.quick.earningsDescription"],
  ["account.quick.library", "/my-ayin", "account.quick.libraryDescription"],
  ["account.quick.notifications", "/notifications", "account.quick.notificationsDescription"],
  ["account.quick.channelSettings", "/channel/edit", "account.quick.channelSettingsDescription"],
] as const satisfies readonly [TranslationKey, string, TranslationKey][];

export function AccountOverview() {
  const { href, t } = useI18n();
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
          setError(caught instanceof Error ? caught.message : t("account.loadError"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [t]);

  if (loading) return <p className={styles.loading}>{t("account.loading")}</p>;
  if (!identity) {
    return (
      <p className={styles.error}>
        {error || t("account.signInRequired")} <Link href={href("/login")}>{t("auth.signIn")}</Link>
      </p>
    );
  }

  return (
    <>
      <section className={styles.identityCard} aria-label={t("account.identityAria")}>
        <div>
          <strong dir="auto">{identity.account.displayName}</strong>
          <span dir="ltr">{identity.account.email}</span>
        </div>
        <Link className={styles.handle} dir="ltr" href={href(`/c/${identity.channel.handle}`)}>
          @{identity.channel.handle}
        </Link>
      </section>

      <nav className={styles.quickGrid} aria-label={t("account.shortcutsAria")}>
        {quickLinks.map(([label, targetHref, description]) => (
          <Link className={styles.linkCard} href={href(targetHref)} key={targetHref}>
            <strong>{t(label)}</strong>
            <span>{t(description)}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
