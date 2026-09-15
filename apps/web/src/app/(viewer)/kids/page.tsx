import type { Metadata } from "next";

import { DiscoveryHome } from "@/components/discovery/discovery-home";
import { absoluteUrl, metadataRobots } from "@/lib/seo";

import styles from "./kids.module.css";

export const metadata: Metadata = {
  title: "AYIN Kids",
  description: "A restricted AYIN catalog surface for explicitly classified Kids-eligible content.",
  alternates: { canonical: absoluteUrl("/kids") },
  robots: metadataRobots(true),
};

export default function KidsPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>AYIN Kids</span>
        <h1>Kids-safe catalog</h1>
        <p>
          This surface only shows videos explicitly classified as Kids-eligible. Unclassified,
          teen, mature, and age-restricted content is excluded by backend policy.
        </p>
        <div className={styles.policy}>
          <span>Personalized ad targeting: disabled</span>
          <span>Community interactions: disabled on this surface</span>
          <span>Children&apos;s privacy compliance is not claimed without dedicated legal review</span>
        </div>
      </section>

      <section aria-label="AYIN Kids catalog" className={styles.catalog}>
        <DiscoveryHome kidsMode />
      </section>
    </main>
  );
}
