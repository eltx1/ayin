import { ActionLink, PageHeader } from "@/components/ui/design-system";
import Link from "next/link";
import { mediaAssetUrl } from "@/lib/channel";
import type { Locale } from "@/lib/i18n/config";
import { localizePath } from "@/lib/i18n/routing";
import { translate } from "@/lib/i18n/translator";
import {
  directorySections,
  fetchPublicDirectory,
  isDirectoryCursor,
  type DirectorySection,
} from "@/lib/public-directory";
import { trustedApiRegionHeaders } from "@/lib/trusted-region";
import { MediaCard } from "./media-card";
import { EmptyState, ErrorState } from "./view-states";
import styles from "./public-directory.module.css";

export async function PublicDirectory({
  section,
  locale,
  cursor,
}: {
  section: DirectorySection;
  locale: Locale;
  cursor?: string | string[] | undefined;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const path = localizePath(`/${section}`, locale);
  const invalidCursor = cursor !== undefined && !isDirectoryCursor(cursor);
  let page: Awaited<ReturnType<typeof fetchPublicDirectory>> | null = null;
  if (!invalidCursor) {
    try {
      page = await fetchPublicDirectory(
        section,
        locale,
        cursor as string | undefined,
        await trustedApiRegionHeaders(),
      );
    } catch {
      /* The recovery view distinguishes an unavailable request from a real empty catalog. */
    }
  }
  const retry =
    typeof cursor === "string" && !invalidCursor
      ? `${path}?${new URLSearchParams({ cursor })}`
      : path;
  return (
    <main className={styles.page}>
      <PageHeader
        title={t(`nav.${section}`)}
        description={t(`browse.${section}Description`)}
        eyebrow={
          <Link href={localizePath("/", locale)} className={styles.back}>
            {t("nav.home")}
          </Link>
        }
      >
        <nav aria-label={t("browse.categories")} className={styles.categories}>
          {directorySections.map((category) => (
            <Link
              key={category}
              href={localizePath(`/${category}`, locale)}
              aria-current={category === section ? "page" : undefined}
            >
              {t(`nav.${category}`)}
            </Link>
          ))}
          <Link href={localizePath("/clips", locale)}>{t("nav.shorts")}</Link>
        </nav>
      </PageHeader>
      {!page ? (
        <ErrorState
          title={t(invalidCursor ? "browse.invalidPage" : "browse.errorTitle")}
          description={t("browse.errorDescription")}
          action={
            <ActionLink href={retry} prefetch={false}>
              {t(invalidCursor ? "browse.firstPage" : "browse.retry")}
            </ActionLink>
          }
        />
      ) : page.items.length === 0 ? (
        <EmptyState
          title={t(cursor ? "browse.endTitle" : "browse.emptyTitle")}
          description={t("browse.emptyDescription")}
          action={
            <ActionLink href={cursor ? path : localizePath("/search", locale)}>
              {t(cursor ? "browse.firstPage" : "nav.search")}
            </ActionLink>
          }
        />
      ) : (
        <ul className={styles.grid} aria-label={t(`nav.${section}`)}>
          {page.items.map((item) => (
            <li key={item.id}>
              <MediaCard
                title={item.title}
                href={localizePath(item.href, locale)}
                {...(item.meta ? { meta: item.meta } : {})}
                {...(mediaAssetUrl(item.artworkObjectKey)
                  ? { artworkUrl: mediaAssetUrl(item.artworkObjectKey)! }
                  : {})}
                variant={section === "tv" || section === "creators" ? "landscape" : "poster"}
              />
            </li>
          ))}
        </ul>
      )}
      {page && (cursor || page.nextCursor) ? (
        <nav className={styles.pagination} aria-label={t("browse.pages")}>
          {cursor ? <ActionLink href={path}>{t("browse.firstPage")}</ActionLink> : null}
          {page.nextCursor ? (
            <ActionLink
              prefetch={false}
              href={`${path}?${new URLSearchParams({ cursor: page.nextCursor })}`}
            >
              {t("browse.more")}
            </ActionLink>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
