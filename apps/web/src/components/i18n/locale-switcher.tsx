"use client";

import { usePathname } from "next/navigation";

import { localeSwitchHref, stripLocalePrefix } from "@/lib/i18n/routing";

import { useI18n } from "./i18n-provider";
import styles from "./locale-switcher.module.css";

export function LocaleSwitcher({ placement = "page" }: { placement?: "page" | "menu" }) {
  const pathname = usePathname() ?? "/";
  const { locale, t } = useI18n();

  const immersive = stripLocalePrefix(pathname).replace(/\/$/, "") === "/clips";
  if ((placement === "page" && immersive) || (placement === "menu" && !immersive)) return null;

  return (
    <nav
      aria-label={t("shell.language")}
      className={`${styles.switcher} ${placement === "menu" ? styles.menu : ""}`}
    >
      <span className={styles.label}>{t("shell.language")}</span>
      <a
        aria-current={locale === "en" ? "page" : undefined}
        className={`${styles.link} ${locale === "en" ? styles.active : ""}`}
        href={localeSwitchHref(pathname, "en")}
        data-tv-focusable="true"
        data-tv-focus-id={`locale-${placement}-en`}
        hrefLang="en"
      >
        {t("shell.english")}
      </a>
      <a
        aria-current={locale === "ar" ? "page" : undefined}
        className={`${styles.link} ${locale === "ar" ? styles.active : ""}`}
        href={localeSwitchHref(pathname, "ar")}
        data-tv-focusable="true"
        data-tv-focus-id={`locale-${placement}-ar`}
        hrefLang="ar"
      >
        {t("shell.arabic")}
      </a>
    </nav>
  );
}
