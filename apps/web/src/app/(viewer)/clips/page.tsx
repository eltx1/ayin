import { apiBaseUrl } from "../../../lib/api";
import { ClipsFeed, type ClipItem } from "./clips-feed";
import styles from "./clips.module.css";

interface ClipsResponse {
  enabled: boolean;
  items: ClipItem[];
  autoplayEnabled: boolean;
  adPolicy: { enabled: boolean; minimumOrganicClips: number };
}

export default async function ClipsPage() {
  const response = await fetch(`${apiBaseUrl}/public/clips?take=20`, { cache: "no-store" });
  const data: ClipsResponse = response.ok
    ? await response.json()
    : {
        enabled: false,
        items: [],
        autoplayEnabled: false,
        adPolicy: { enabled: false, minimumOrganicClips: 6 },
      };
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>AYIN Clips</h1>
        <p>Short videos from AYIN creators. Swipe or use the arrow keys to move.</p>
      </header>
      {data.enabled ? (
        <ClipsFeed
          items={data.items}
          autoplayEnabled={data.autoplayEnabled}
          adPolicy={data.adPolicy}
        />
      ) : (
        <p>Clips are currently unavailable.</p>
      )}
    </main>
  );
}
