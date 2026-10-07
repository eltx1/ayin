import { QuickUpload } from "@/components/upload/quick-upload";

import { UploadHistory } from "@/components/upload/upload-history";
import { UploadRecovery } from "@/components/upload/upload-recovery";

import styles from "./upload.module.css";

export default function UploadPage() {
  return (
    <main className={styles.page}>
      <div className={styles.workspace}>
        <QuickUpload />
        <UploadRecovery />
        <UploadHistory />
      </div>
    </main>
  );
}
