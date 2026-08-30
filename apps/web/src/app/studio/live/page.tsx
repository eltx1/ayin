import { StudioLiveClient } from "@/components/studio/studio-live-client";

import styles from "../studio.module.css";

export default function StudioLivePage() {
  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>Live</h1>
          <p className={styles.muted}>
            Schedule live sessions and connect them to a configured ingest/transcoding provider.
          </p>
        </div>
      </header>
      <StudioLiveClient />
    </>
  );
}
