import type { Metadata } from "next";
import { PublicSafetyHelp } from "@/components/privacy/public-safety-help";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const ar = (await getRequestLocale()) === "ar";
  return {
    title: ar ? "دعم AYIN والسلامة" : "AYIN support and safety",
    description: ar
      ? "التواصل مع AYIN والإبلاغ والحظر وحذف الحساب."
      : "Contact AYIN, report content, block abuse and manage account deletion.",
  };
}
export default async function SupportPage() {
  return <PublicSafetyHelp kind="support" locale={await getRequestLocale()} />;
}
