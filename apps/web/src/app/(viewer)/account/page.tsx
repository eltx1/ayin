import type { Metadata } from "next";

import { AccountOverview } from "@/components/account/account-overview";
import { AccountPrivacyControls } from "@/components/account/account-privacy-controls";
import { AccountRevenue } from "@/components/account/account-revenue";
import { AccountSecuritySessions } from "@/components/account/account-security-sessions";

import styles from "./account.module.css";

export const metadata: Metadata = {
  title: "Account | AYIN",
};

export default function AccountPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>Your AYIN</span>
        <h1>Account</h1>
        <p>Your channel, videos, analytics, earnings and payouts in one place.</p>
      </header>

      <AccountOverview />

      <AccountSecuritySessions />

      <AccountPrivacyControls />

      <div className={styles.sectionHeading}>
        <h2>Earnings & payouts</h2>
        <p>Track your balance, payment readiness and payout history.</p>
      </div>
      <AccountRevenue />
    </main>
  );
}
