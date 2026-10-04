"use client";

import Link from "next/link";

import styles from "@/app/(viewer)/account/account.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useAccountWorkspace } from "./account-workspace";
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
  const binding = useAccountWorkspace();
  if (!binding) return null;
  const identity = binding.identity;

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
