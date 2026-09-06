import { QuickUpload } from "@/components/upload/quick-upload";

export default function UploadPage() {
  return (
    <main
      style={{
        padding: "clamp(24px, 4.5vw, 64px) var(--shell-gutter) clamp(88px, 10vw, 140px)",
      }}
    >
      <QuickUpload />
    </main>
  );
}
