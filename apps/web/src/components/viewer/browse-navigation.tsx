"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import {
  browseDescriptionKeys,
  buildViewerNavigation,
  navigationLabelKeys,
} from "@/lib/viewer-navigation";

import { useViewerProduct } from "./viewer-product-context";
import styles from "./browse-navigation.module.css";

export function BrowseNavigation() {
  const { href, t, direction } = useI18n();
  const { flags, controls, navigationStatus, retryNavigation } = useViewerProduct();
  const navigation = controls?.navigation;
  const model = useMemo(() => buildViewerNavigation(flags, navigation), [flags, navigation]);

  if (navigationStatus === "loading") {
    return (
      <div className={styles.status} role="status" aria-busy="true">
        {t("browse.loading")}
      </div>
    );
  }

  if (navigationStatus === "error" || model.browse.length === 0) {
    return (
      <div className={styles.status}>
        <p role={navigationStatus === "error" ? "alert" : "status"}>
          {t(navigationStatus === "error" ? "browse.unavailable" : "browse.empty")}
        </p>
        <div className={styles.actions}>
          {navigationStatus === "error" ? (
            <button type="button" onClick={retryNavigation}>
              {t("browse.retry")}
            </button>
          ) : null}
          <Link href={href("/search")}>{t("nav.search")}</Link>
        </div>
      </div>
    );
  }

  return (
    <nav aria-label={t("browse.aria")} className={styles.categories}>
      {model.browse.map((item) => {
        const label = navigationLabelKeys[item.key];
        const description = browseDescriptionKeys[item.key];
        return (
          <Link
            href={href(item.href)}
            key={item.key}
            data-tv-focusable="true"
            data-tv-focus-id={`browse-${item.key}`}
          >
            <span>
              <strong>{label ? t(label) : item.label}</strong>
              {description ? <span>{t(description)}</span> : null}
            </span>
            <span className={styles.arrow} aria-hidden="true">
              {direction === "rtl" ? "←" : "→"}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
