"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import styles from "./mfa-secrets.module.css";

export function MfaEnrollmentSecret({
  enrollment,
  label,
}: {
  enrollment: { qrCodeDataUrl: string; secret: string };
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.provisioning}>
      <Image alt={label} height={240} src={enrollment.qrCodeDataUrl} unoptimized width={240} />
      <details>
        <summary>{t("auth.cannotScan")}</summary>
        <p>{t("auth.manualKey")}</p>
        <code dir="ltr">{enrollment.secret}</code>
      </details>
    </div>
  );
}

export function MfaRecoveryCodes({
  codes,
  onDone,
  headingLevel = 3,
}: {
  codes: readonly string[];
  onDone: () => void;
  headingLevel?: 1 | 3;
}) {
  const { t } = useI18n();
  const Heading = headingLevel === 1 ? "h1" : "h3";
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className={styles.recovery}>
      <Heading ref={heading} tabIndex={-1}>
        {t("auth.recoveryTitle")}
      </Heading>
      <p>{t("auth.recoveryIntro")}</p>
      <ul className={styles.codes} aria-label={t("auth.recoveryTitle")} dir="ltr">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <button className={styles.done} onClick={onDone} type="button">
        {t("auth.savedCodes")}
      </button>
    </div>
  );
}
