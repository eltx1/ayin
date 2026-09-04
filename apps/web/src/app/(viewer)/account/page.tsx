import type { Metadata } from "next";

import { AccountOverview } from "@/components/account/account-overview";
import { StudioRevenue } from "@/components/studio/studio-revenue";

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
        <p>
          Your channel, videos, analytics, earnings and payouts in one place.
        </p>
      </header>

      <AccountOverview />

      <div className={styles.sectionHeading}>
        <h2>Earnings & payouts</h2>
        <p>Track your balance, payment readiness and payout history.</p>
      </div>
      <StudioRevenue />
    </main>
  );
}
