import type { Metadata } from "next";

import { AccountOverview } from "@/components/account/account-overview";
import { AccountPrivacyControls } from "@/components/account/account-privacy-controls";
import { AccountRevenue } from "@/components/account/account-revenue";
import { AccountSecuritySessions } from "@/components/account/account-security-sessions";
import { getRequestLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translator";

import styles from "./account.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: translate(locale, "account.metaTitle") };
}

export default async function AccountPage() {
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>{t("account.eyebrow")}</span>
        <h1>{t("account.title")}</h1>
        <p>{t("account.intro")}</p>
      </header>

      <AccountOverview />
      <AccountSecuritySessions />
      <AccountPrivacyControls />

      <div className={styles.sectionHeading}>
        <h2>{t("account.earningsTitle")}</h2>
        <p>{t("account.earningsDescription")}</p>
      </div>
      <AccountRevenue />
    </main>
  );
}
