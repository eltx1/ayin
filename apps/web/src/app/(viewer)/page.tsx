import { DiscoveryHome } from "@/components/discovery/discovery-home";
import { ManagedHero } from "@/components/viewer/managed-hero";

import { SessionPanel } from "../session-panel";
import styles from "./page.module.css";

interface HomeProperties {
  searchParams: Promise<{ welcome?: string }>;
}

export default async function Home({ searchParams }: HomeProperties) {
  const params = await searchParams;

  return (
    <main>
      <ManagedHero />

      <div className={styles.homeBody}>
        <section aria-label="AYIN account" className={styles.accountStrip}>
          <SessionPanel showWelcome={params.welcome === "1"} />
        </section>

        <section id="discovery">
          <DiscoveryHome />
        </section>
      </div>
    </main>
  );
}
