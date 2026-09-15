import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppNavLink } from "@/components/ui/app-nav-link";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizePath } from "@/lib/i18n/routing";
import { translate, type TranslationKey } from "@/lib/i18n/translator";

import styles from "./studio.module.css";

const navigation = [
  ["studio.dashboard", "/studio"],
  ["studio.content", "/studio/content"],
  ["studio.playlists", "/studio/playlists"],
  ["studio.tv", "/studio/tv"],
  ["studio.analytics", "/studio/analytics"],
  ["studio.comments", "/studio/comments"],
  ["studio.community", "/studio/community"],
  ["studio.live", "/studio/live"],
  ["studio.monetization", "/studio/monetization"],
  ["studio.support", "/studio/support"],
  ["studio.trustSafety", "/studio/trust"],
  ["studio.channelSettings", "/studio/channel"],
] as const satisfies readonly [TranslationKey, string][];

export default async function StudioLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <aside className={styles.sidebar}>
          <Link aria-label={t("studio.aria")} className={styles.brand} href={localizePath("/studio", locale)}>
            <span className={styles.brandLogo}>
              <Image alt="" height={72} priority src="/brand/ayin-logo.png" width={72} />
            </span>
            <span>
              <strong>AYIN</strong>
              <small>{t("studio.brand")}</small>
            </span>
          </Link>
          <nav aria-label={t("studio.aria")} className={styles.nav}>
            {navigation.map(([key, targetHref]) => (
              <AppNavLink href={localizePath(targetHref, locale)} key={targetHref}>
                {t(key)}
              </AppNavLink>
            ))}
          </nav>
          <Link className={styles.back} href={localizePath("/", locale)}>
            <span aria-hidden="true">{locale === "ar" ? "→" : "←"}</span> {t("studio.backToAyin")}
          </Link>
        </aside>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
