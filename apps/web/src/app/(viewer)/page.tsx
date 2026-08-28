import { ContentRow } from "@/components/viewer/content-row";
import { Hero } from "@/components/viewer/hero";
import { MediaCard, type MediaCardTone } from "@/components/viewer/media-card";

import { SessionPanel } from "../session-panel";
import styles from "./page.module.css";

interface HomeProperties {
  searchParams: Promise<{ welcome?: string }>;
}

const previews = [
  { title: "Preview 01", tone: 1 },
  { title: "Preview 02", tone: 2 },
  { title: "Preview 03", tone: 3 },
  { title: "Preview 04", tone: 4 },
  { title: "Preview 05", tone: 5 },
  { title: "Preview 06", tone: 2 },
] as const;

function cards(variant: "poster" | "landscape", prefix: string) {
  return previews.map((preview, index) => (
    <MediaCard
      badge={index === 0 ? "AYIN" : undefined}
      href={`/search?preview=${prefix}-${index + 1}`}
      key={`${prefix}-${preview.title}`}
      kicker={variant === "landscape" ? "Featured preview" : "Popular now"}
      meta="Design-system placeholder"
      title={preview.title}
      tone={preview.tone as MediaCardTone}
      variant={variant}
    />
  ));
}

export default async function Home({ searchParams }: HomeProperties) {
  const params = await searchParams;

  return (
    <main>
      <Hero
        description="A global entertainment network built for watching, discovering and creating without friction. One account becomes your profile, channel and Creator TV."
        eyebrow="Watch · Create · Tune in"
        primaryAction={{ href: "#trending", label: "Explore previews" }}
        secondaryAction={{ href: "/search", label: "Search AYIN" }}
        title="Stories move differently here."
      />

      <div className={styles.homeBody}>
        <section aria-label="AYIN account" className={styles.accountStrip}>
          <SessionPanel showWelcome={params.welcome === "1"} />
        </section>

        <ContentRow anchorId="trending" eyebrow="Discovery" rowId="trending" title="Trending Worldwide">
          {cards("landscape", "trending")}
        </ContentRow>

        <ContentRow eyebrow="Right now" rowId="popular" title="Popular Now">
          {cards("poster", "popular")}
        </ContentRow>

        <ContentRow eyebrow="Always on" rowId="creator-tv" title="Creator TV">
          {cards("landscape", "creator-tv")}
        </ContentRow>
      </div>
    </main>
  );
}
