import { notFound } from "next/navigation";

import { EmptyState } from "@/components/viewer/view-states";

import styles from "./page.module.css";

const sectionCopy = {
  movies: {
    title: "Movies",
    description: "Feature-length discovery will live here as the AYIN catalog comes online.",
  },
  series: {
    title: "Series",
    description: "Series, seasons and episodes will gather here in a TV-friendly browsing surface.",
  },
  tv: {
    title: "TV",
    description: "Creator TV and future linear experiences will share this focused destination.",
  },
  creators: {
    title: "Creators",
    description: "Discover channels and the people building what comes next on AYIN.",
  },
  shorts: {
    title: "Shorts / Clips",
    description: "Fast, lightweight discovery will arrive here without complicating long-form viewing.",
  },
  kids: {
    title: "Kids",
    description: "A dedicated family-oriented surface is reserved here for a later product phase.",
  },
  "my-ayin": {
    title: "My AYIN",
    description: "Continue Watching, lists, subscriptions and history will come together here.",
  },
  search: {
    title: "Search",
    description: "Search across AYIN as the catalog and discovery data become available.",
  },
} as const;

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const copy = sectionCopy[section as keyof typeof sectionCopy];
  if (!copy) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <p>AYIN</p>
        <h1>{copy.title}</h1>
      </div>
      <EmptyState description={copy.description} title="Ready for the next layer" />
    </main>
  );
}
