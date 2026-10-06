import { ActionLink, PageHeader } from "@/components/ui/design-system";
import Link from "next/link";
import { mediaAssetUrl } from "@/lib/channel";
import type { Locale } from "@/lib/i18n/config";
import { translateCatalogDetail } from "@/lib/i18n/catalog-detail";
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
  query,
}: {
  section: DirectorySection;
  locale: Locale;
  cursor?: string | string[] | undefined;
  query?: string | string[] | undefined;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const catalogText = (key: Parameters<typeof translateCatalogDetail>[1]) =>
    translateCatalogDetail(locale, key);
  const path = localizePath(`/${section}`, locale);
  const searchable = section === "movies" || section === "series";
  const search = searchable && typeof query === "string" ? query.trim() : "";
  const invalidCursor = cursor !== undefined && !isDirectoryCursor(cursor);
  const invalidSearch =
    searchable && query !== undefined && (typeof query !== "string" || search.length > 100);
  const pageLink = (nextCursor?: string) => {
    const params = new URLSearchParams();
    if (search && !invalidSearch) params.set("q", search);
    if (nextCursor) params.set("cursor", nextCursor);
    return `${path}${params.size ? `?${params}` : ""}`;
  };
  let page: Awaited<ReturnType<typeof fetchPublicDirectory>> | null = null;
  if (!invalidCursor && !invalidSearch) {
    try {
      page = await fetchPublicDirectory(
        section,
        locale,
        cursor as string | undefined,
        await trustedApiRegionHeaders(),
        search,
      );
    } catch {
      /* The recovery view distinguishes an unavailable request from a real empty catalog. */
    }
  }
  const retry = typeof cursor === "string" && !invalidCursor ? pageLink(cursor) : pageLink();
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
      {searchable ? (
        <form
          key={`${section}:${locale}:${search}`}
          action={path}
          method="get"
          role="search"
          className={styles.search}
        >
          <label htmlFor="catalog-search">{catalogText(`browse.search.${section}`)}</label>
          <div>
            <input
              id="catalog-search"
              name="q"
              type="search"
              defaultValue={search}
              maxLength={100}
              dir="auto"
            />
            <button type="submit">{catalogText("browse.search.submit")}</button>
            {search ? (
              <ActionLink href={path} tone="secondary">
                {catalogText("browse.search.clear")}
              </ActionLink>
            ) : null}
          </div>
        </form>
      ) : null}
      {!page ? (
        <ErrorState
          title={
            invalidSearch
              ? catalogText("browse.search.invalid")
              : t(invalidCursor ? "browse.invalidPage" : "browse.errorTitle")
          }
          description={t("browse.errorDescription")}
          action={
            <ActionLink href={retry} prefetch={false}>
              {t(invalidCursor || invalidSearch ? "browse.firstPage" : "browse.retry")}
            </ActionLink>
          }
        />
      ) : page.items.length === 0 ? (
        <EmptyState
          title={
            search
              ? catalogText("browse.search.empty")
              : t(cursor ? "browse.endTitle" : "browse.emptyTitle")
          }
          description={
            search ? catalogText("browse.search.emptyDescription") : t("browse.emptyDescription")
          }
          action={
            <ActionLink
              href={search ? path : cursor ? pageLink() : localizePath("/search", locale)}
            >
              {search
                ? catalogText("browse.search.clear")
                : t(cursor ? "browse.firstPage" : "nav.search")}
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
          {cursor ? <ActionLink href={pageLink()}>{t("browse.firstPage")}</ActionLink> : null}
          {page.nextCursor ? (
            <ActionLink prefetch={false} href={pageLink(page.nextCursor)}>
              {t("browse.more")}
            </ActionLink>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
