import { AdminVideoAds } from "@/components/admin/admin-video-ads";

export default async function AdminVideoAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = typeof params.query === "string" ? params.query : "";
  return <AdminVideoAds key={query ?? ""} initialQuery={query ?? ""} />;
}
