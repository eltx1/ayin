import type { Metadata } from "next";

import { PageAdSlot } from "@/components/ads/page-ad-slot";
import { DiscoveryHome } from "@/components/discovery/discovery-home";
import { ManagedHero } from "@/components/viewer/managed-hero";
import { localizePath } from "@/lib/i18n/routing";
import { localizedAlternates } from "@/lib/i18n/seo";
import { getRequestLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translator";
import { absoluteUrl, AYIN_DEFAULT_IMAGE, metadataRobots } from "@/lib/seo";

import { SessionPanel } from "../session-panel";
import styles from "./page.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const title = translate(locale, "meta.home.title");
  const description = translate(locale, "meta.home.description");
  const url = absoluteUrl(localizePath("/", locale));

  return {
    title,
    description,
    alternates: localizedAlternates("/", locale),
    robots: metadataRobots(true),
    openGraph: {
      type: "website",
      siteName: "AYIN",
      title: `AYIN — ${title}`,
      description,
      url,
      images: [{ url: AYIN_DEFAULT_IMAGE, alt: "AYIN" }],
    },
    twitter: {
      card: "summary_large_image",
      title: `AYIN — ${title}`,
      description,
      images: [AYIN_DEFAULT_IMAGE],
    },
  };
}

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
