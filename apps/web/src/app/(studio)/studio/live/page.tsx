import { StudioLiveClient } from "./studio-live-client";

export default function StudioLivePage() {
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "24px" }}>
      <h1>Live</h1>
      <p>Schedule live sessions and connect them to a configured ingest/transcoding provider.</p>
      <StudioLiveClient />
    </main>
  );
}
