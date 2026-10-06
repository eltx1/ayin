"use client";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Disclosure } from "@/components/ui/data-presentation";
import { catalogValidationReason } from "@/lib/catalog-validation-copy";
import styles from "@/app/admin/admin.module.css";

export function CatalogValidationIssues({ issues }: { issues: string[] }) {
  const { locale } = useI18n();
  if (!issues.length) return null;
  return (
    <div className={styles.error}>
      <strong>{locale === "ar" ? "قبل النشر" : "Before publishing"}</strong>
      <ul>
        {issues.map((code, index) => (
          <li key={`${index}:${code}`}>{catalogValidationReason(code, locale)}</li>
        ))}
      </ul>
      <Disclosure summary={locale === "ar" ? "رموز التشخيص" : "Diagnostic codes"}>
        <p dir="ltr">{issues.join(" · ")}</p>
      </Disclosure>
    </div>
  );
}
