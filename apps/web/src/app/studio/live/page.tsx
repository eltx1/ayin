import { StudioLiveClient } from "@/components/studio/studio-live-client";

import { getRequestLocale } from "@/lib/i18n/server";

import styles from "../studio.module.css";

export default async function StudioLivePage() {
  const ar = (await getRequestLocale()) === "ar";
  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{ar ? "استوديو المنشئ" : "Creator Studio"}</span>
          <h1>{ar ? "البث المباشر" : "Live"}</h1>
          <p className={styles.muted}>
            {ar
              ? "خطط لجلساتك وجهّز المرمّز وتابع حالة البث."
              : "Plan sessions, set up your encoder and check live status."}
          </p>
        </div>
      </header>
      <StudioLiveClient />
    </>
  );
}
