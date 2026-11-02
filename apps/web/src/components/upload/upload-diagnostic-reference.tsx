import type { Locale } from "@/lib/i18n/config";
import { uploadText } from "@/lib/upload-copy";
import {
  uploadClientErrorName,
  uploadDiagnosticStageLabel,
  uploadRecoveryDiagnostic,
} from "@/lib/upload-recovery-diagnostics";

export function UploadDiagnosticReference({
  code,
  locale,
  stage,
  clientErrorName,
}: {
  code: string | null | undefined;
  locale: Locale;
  stage?: string | null;
  clientErrorName?: string | null;
}) {
  const reference = code ? uploadRecoveryDiagnostic(code).reference : null;
  const stageLabel = uploadDiagnosticStageLabel(stage);
  const clientName = uploadClientErrorName(clientErrorName);
  return reference || stageLabel || clientName ? (
    <p>
      <small>
        {stageLabel && (
          <>
            {uploadText("Stage", locale)}: {uploadText(stageLabel, locale)}
          </>
        )}
        {reference && (
          <>
            {stageLabel && " · "}
            {uploadText("Reference", locale)}: <bdi dir="ltr">{reference}</bdi>
          </>
        )}
        {clientName && (
          <>
            {(stageLabel || reference) && " · "}
            {uploadText("Client error", locale)}: <bdi dir="ltr">{clientName}</bdi>
          </>
        )}
      </small>
    </p>
  ) : null;
}
