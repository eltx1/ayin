"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { localeSwitchHref } from "@/lib/i18n/routing";

import { useI18n } from "./i18n-provider";
import styles from "./locale-switcher.module.css";

export function LocaleSwitcher() {
  const pathname = usePathname() ?? "/";
  const { locale, t } = useI18n();

  return (
    <nav aria-label={t("shell.language")} className={styles.switcher}>
      <span className={styles.label}>{t("shell.language")}</span>
      <Link
        aria-current={locale === "en" ? "page" : undefined}
        className={`${styles.link} ${locale === "en" ? styles.active : ""}`}
        href={localeSwitchHref(pathname, "en")}
        hrefLang="en"
      >
        {t("shell.english")}
      </Link>
      <Link
        aria-current={locale === "ar" ? "page" : undefined}
        className={`${styles.link} ${locale === "ar" ? styles.active : ""}`}
        href={localeSwitchHref(pathname, "ar")}
        hrefLang="ar"
      >
        {t("shell.arabic")}
      </Link>
    </nav>
  );
}
