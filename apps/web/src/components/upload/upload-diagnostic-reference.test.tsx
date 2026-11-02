import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadText } from "@/lib/upload-copy";
import {
  uploadRecoveryDiagnostic,
  uploadFailureContext,
  uploadDiagnosticStageLabel,
} from "@/lib/upload-recovery-diagnostics";
import { UploadDiagnosticReference } from "./upload-diagnostic-reference";

const referenceCodes = [
  "CHANNEL_UPLOAD_QUOTA_REACHED",
  "UPLOAD_ADMISSION_LIMIT",
  "UPLOAD_PHYSICAL_DEBT_LIMIT",
  "UPLOAD_RATE_LIMITED",
  "UPLOAD_OUTPUT_ENVELOPE_UNAVAILABLE",
  "UPLOAD_CAPACITY_BUSY",
  "UPLOAD_CANARY_BUSY",
  "VIDEO_TOO_LARGE",
  "INVALID_RESPONSE",
  "UNCERTAIN",
] as const;

afterEach(() => vi.unstubAllGlobals());

describe("display-only recovery diagnostics", () => {
  for (const locale of ["en", "ar"] as const)
    it.each(referenceCodes)(
      `renders a fixed ${locale} message and safe reference for %s`,
      (code) => {
        const diagnostic = uploadRecoveryDiagnostic(code);
        expect(diagnostic.reference).toBe(code);
        const translated = uploadText(diagnostic.detail, locale);
        if (locale === "ar") {
          expect(translated).not.toBe(diagnostic.detail);
          expect(translated).toMatch(/[\u0600-\u06ff]/);
        }
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);
        const html = renderToStaticMarkup(
          <div role="alert" dir={locale === "ar" ? "rtl" : "ltr"}>
            <p>{translated}</p>
            <UploadDiagnosticReference code={diagnostic.reference} locale={locale} />
          </div>,
        );
        expect(html).toContain(locale === "ar" ? "الرمز المرجعي" : "Reference");
        expect(html).toContain(`<bdi dir="ltr">${code}</bdi>`);
        expect(html).not.toMatch(/<button|<a |<form|<script/);
        expect(fetcher).not.toHaveBeenCalled();
      },
    );

  it("distinguishes quota, outstanding work, debt, throttling and processing allowance without claiming a saved video", () => {
    const details = referenceCodes.slice(0, 5).map((code) => uploadRecoveryDiagnostic(code).detail);
    expect(new Set(details).size).toBe(5);
    expect(details[0]).toContain("channel does not have enough storage");
    expect(details[1]).toContain("Existing uploads or cleanup work");
    expect(details[2]).toContain("upload storage allowance is unavailable");
    expect(details[3]).toContain("Too many upload requests");
    expect(details[4]).toContain("processing storage allowance");
    for (const code of referenceCodes)
      expect(uploadRecoveryDiagnostic(code).detail).not.toMatch(/upload is safe|upload is saved/);
  });

  it.each([
    "UNRECOGNIZED_SERVER_CODE",
    "constructor",
    "__proto__",
    "UPLOAD_PHYSICAL_DEBT_LIMIT secret",
    "https://storage.invalid/private?token=secret",
    "<script>privateAccountId</script>",
    "",
  ])("suppresses unknown codes and arbitrary server detail: %s", (code) => {
    const diagnostic = uploadRecoveryDiagnostic(code);
    expect(diagnostic).toEqual({
      reference: null,
      detail:
        "The transfer needs checking. Retry will inspect the saved parts and continue this same video.",
    });
    for (const locale of ["en", "ar"] as const)
      expect(renderToStaticMarkup(<UploadDiagnosticReference code={code} locale={locale} />)).toBe(
        "",
      );
  });

  it("retains the existing account/file recovery messages without exposing their codes", () => {
    expect(uploadRecoveryDiagnostic("UPLOAD_FILE_CHANGED")).toEqual({
      reference: null,
      detail:
        "This is not the original video. Reselect the exact original file to resume the saved upload.",
    });
    expect(uploadRecoveryDiagnostic("AUTHORITY_UNVERIFIED")).toEqual({
      reference: null,
      detail:
        "Your current account could not be verified. Check your connection and sign in again.",
    });
    expect(renderToStaticMarkup(<UploadDiagnosticReference code={undefined} locale="en" />)).toBe(
      "",
    );
  });

  for (const locale of ["en", "ar"] as const)
    it.each([
      "LOCAL_PREFLIGHT",
      "LOCAL_METADATA",
      "RECOVERY_CHECK",
      "SOURCE_HASH",
      "LOCAL_SETUP",
      "SERVER_INIT",
    ])(`renders an allowlisted ${locale} stage without depending on a server code: %s`, (stage) => {
      const context = uploadFailureContext(
        stage,
        new DOMException("https://private.invalid?token=secret", "NotReadableError"),
      );
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const html = renderToStaticMarkup(
        <UploadDiagnosticReference code="UNKNOWN_SERVER_CODE" locale={locale} {...context} />,
      );
      expect(html).toContain(uploadText("Stage", locale));
      expect(html).toContain(uploadText(uploadDiagnosticStageLabel(stage)!, locale));
      if (locale === "ar")
        expect(uploadText(uploadDiagnosticStageLabel(stage)!, locale)).toMatch(/[\u0600-\u06ff]/);
      expect(html).toContain(`<bdi dir="ltr">NotReadableError</bdi>`);
      expect(html).toContain(uploadText("Client error", locale));
      expect(html).not.toMatch(/private|secret|UNKNOWN_SERVER_CODE|<button|<a |<form|<script/);
      expect(fetcher).not.toHaveBeenCalled();
    });

  it.each([
    "Error",
    "TypeError",
    "RangeError",
    "AbortError",
    "NotReadableError",
    "NotFoundError",
    "SecurityError",
    "QuotaExceededError",
    "InvalidStateError",
    "DataCloneError",
    "NetworkError",
    "TimeoutError",
    "UploadProtocolError",
  ])("accepts only the fixed client name %s, never its message or stack", (name) => {
    const error = new Error("private filename and token=secret");
    error.name = name;
    expect(uploadFailureContext("SOURCE_HASH", error)).toEqual({
      stage: "SOURCE_HASH",
      clientErrorName: name,
    });
    expect(JSON.stringify(uploadFailureContext("SOURCE_HASH", error))).not.toMatch(
      /private|secret|stack/,
    );
  });

  it.each([
    "constructor",
    "__proto__",
    "SERVER_INIT token=secret",
    "https://private.invalid",
    "<script>secret</script>",
  ])("suppresses arbitrary stage and client names: %s", (value) => {
    const error = new Error("secret");
    error.name = value;
    expect(uploadFailureContext(value, error)).toEqual({ stage: null, clientErrorName: null });
    for (const locale of ["en", "ar"] as const)
      expect(
        renderToStaticMarkup(
          <UploadDiagnosticReference
            code={value}
            stage={value}
            clientErrorName={value}
            locale={locale}
          />,
        ),
      ).toBe("");
  });

  it("does not treat a server-shaped object as a client exception or let an unsafe name accessor break diagnostics", () => {
    expect(
      uploadFailureContext("SOURCE_HASH", { name: "RangeError", message: "secret" })
        .clientErrorName,
    ).toBeNull();
    const error = new Error("secret");
    Object.defineProperty(error, "name", {
      get() {
        throw new Error("secret");
      },
    });
    expect(uploadFailureContext("SOURCE_HASH", error)).toEqual({
      stage: "SOURCE_HASH",
      clientErrorName: null,
    });
  });
});
