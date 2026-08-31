import { AdminVideos } from "@/components/admin/admin-videos";

type AdminVideosPageProps = {
  searchParams: Promise<{ query?: string | string[] }>;
};

export default async function AdminVideosPage({ searchParams }: AdminVideosPageProps) {
  const params = await searchParams;
  const query = Array.isArray(params.query) ? (params.query[0] ?? "") : (params.query ?? "");
  return <AdminVideos initialQuery={query} />;
}
