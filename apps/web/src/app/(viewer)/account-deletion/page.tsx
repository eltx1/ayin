import type { Metadata } from "next";
import { PublicSafetyHelp } from "@/components/privacy/public-safety-help";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const ar = (await getRequestLocale()) === "ar";
  return {
    title: ar ? "حذف حساب AYIN" : "Delete your AYIN account",
    description: ar
      ? "طلب حذف حساب AYIN والبيانات المرتبطة، وفترة السماح وبيانات التواصل."
      : "Request AYIN account and associated data deletion, review the grace period and find privacy contact information.",
  };
}
export default async function AccountDeletionPage() {
  return <PublicSafetyHelp kind="deletion" locale={await getRequestLocale()} />;
}
