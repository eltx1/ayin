import { DiscoveryHome } from "@/components/discovery/discovery-home";
import { Hero } from "@/components/viewer/hero";

import { SessionPanel } from "../session-panel";
import styles from "./page.module.css";

interface HomeProperties {
  searchParams: Promise<{ welcome?: string }>;
}

export default async function Home({ searchParams }: HomeProperties) {
  const params = await searchParams;

  return (
    <main>
      <Hero
        description="A global entertainment network built for watching, discovering and creating without friction. Discovery is powered by real AYIN catalog and viewing data."
        eyebrow="Watch · Create · Tune in"
        primaryAction={{ href: "#discovery", label: "Start exploring" }}
        secondaryAction={{ href: "/search", label: "Search AYIN" }}
        title="Stories move differently here."
      />

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
