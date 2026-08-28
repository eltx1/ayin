import { QuickUpload } from "@/components/upload/quick-upload";

export default function UploadPage() {
  return (
    <main style={{ padding: "clamp(32px, 7vw, 96px) var(--shell-gutter) 120px" }}>
      <QuickUpload />
    </main>
  );
}
