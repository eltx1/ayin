"use client";
import { useI18n } from "@/components/i18n/i18n-provider";
import { QuickUpload } from "@/components/upload/quick-upload";

import { UploadHistory } from "@/components/upload/upload-history";
import { UploadRecovery } from "@/components/upload/upload-recovery";

import styles from "./upload.module.css";

export default function UploadPage() {
  const { locale } = useI18n();
  return (
    <main className={styles.page}>
      <div className={styles.workspace}>
        <QuickUpload />
        <details className={styles.secondaryFlow}>
          <summary>{locale === "ar" ? "استئناف رفع سابق" : "Resume an earlier upload"}</summary>
          <UploadRecovery />
        </details>
        <details className={styles.secondaryFlow}>
          <summary>{locale === "ar" ? "أحدث عمليات الرفع" : "Recent uploads"}</summary>
          <UploadHistory />
        </details>
      </div>
    </main>
  );
}
