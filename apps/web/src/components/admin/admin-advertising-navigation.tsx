"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionLink } from "@/components/ui/design-system";
import { adminAdvertisingAr, adminAdvertisingEn } from "@/lib/i18n/resources/admin-advertising";
import styles from "./admin-advertising-navigation.module.css";

// These are route links, not stateful tabs: the existing editors keep their own
// authorization, request binding and departure guards, including modified clicks.
export function AdminAdvertisingNavigation({ current }: { current: "page" | "video" }) {
  const { locale, href } = useI18n();
  const copy = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
  return (
    <nav className={styles.navigation} aria-label={copy.navigation}>
      <ActionLink
        href={href("/admin/advertising")}
        aria-current={current === "page" ? "page" : undefined}
      >
        {copy.pageArea}
      </ActionLink>
      <ActionLink
        href={href("/admin/video-ads")}
        aria-current={current === "video" ? "page" : undefined}
      >
        {copy.videoArea}
      </ActionLink>
    </nav>
  );
}
