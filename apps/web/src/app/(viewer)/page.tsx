import type { Metadata } from "next";

import { PageAdSlot } from "@/components/ads/page-ad-slot";
import { DiscoveryHome } from "@/components/discovery/discovery-home";
import { ManagedHero } from "@/components/viewer/managed-hero";
import {
  absoluteUrl,
  AYIN_DEFAULT_DESCRIPTION,
  AYIN_DEFAULT_IMAGE,
  metadataRobots,
} from "@/lib/seo";

import { SessionPanel } from "../session-panel";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Watch, Stream & Discover",
  description: AYIN_DEFAULT_DESCRIPTION,
  alternates: { canonical: absoluteUrl("/") },
  robots: metadataRobots(true),
  openGraph: {
    type: "website",
    siteName: "AYIN",
    title: "AYIN — Watch, Stream & Discover",
    description: AYIN_DEFAULT_DESCRIPTION,
    url: absoluteUrl("/"),
    images: [{ url: AYIN_DEFAULT_IMAGE, alt: "AYIN" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AYIN — Watch, Stream & Discover",
    description: AYIN_DEFAULT_DESCRIPTION,
    images: [AYIN_DEFAULT_IMAGE],
  },
};

interface HomeProperties {
  searchParams: Promise<{ welcome?: string }>;
}

export default async function Home({ searchParams }: HomeProperties) {
  const params = await searchParams;

  return (
    <main>
      <ManagedHero />
      <PageAdSlot placementKey="home_top" />

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
