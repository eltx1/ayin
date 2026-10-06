import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDirectory } from "@/components/viewer/public-directory";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizePath } from "@/lib/i18n/routing";
import { translate } from "@/lib/i18n/translator";
import { isDirectorySection } from "@/lib/public-directory";
import { absoluteUrl } from "@/lib/seo";

type Props = {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ cursor?: string | string[]; q?: string | string[] }>;
};
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ section }, query, locale] = await Promise.all([
    params,
    searchParams,
    getRequestLocale(),
  ]);
  if (!isDirectorySection(section)) return { robots: { index: false, follow: false } };
  return {
    title: translate(locale, `nav.${section}`),
    description: translate(locale, `browse.${section}Description`),
    alternates: {
      canonical: absoluteUrl(localizePath(`/${section}`, locale)),
      languages: {
        en: absoluteUrl(`/${section}`),
        ar: absoluteUrl(`/ar/${section}`),
        "x-default": absoluteUrl(`/${section}`),
      },
    },
    robots: { index: !query.cursor && !query.q, follow: true },
  };
}
export default async function SectionPage({ params, searchParams }: Props) {
  const [{ section }, query, locale] = await Promise.all([
    params,
    searchParams,
    getRequestLocale(),
  ]);
  if (!isDirectorySection(section)) notFound();
  return (
    <PublicDirectory section={section} locale={locale} cursor={query.cursor} query={query.q} />
  );
}
