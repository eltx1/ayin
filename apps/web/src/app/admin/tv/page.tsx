import { AdminTv } from "@/components/admin/admin-tv";

export default async function AdminTvPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = Array.isArray(params.query) ? (params.query[0] ?? "") : (params.query ?? "");
  return <AdminTv key={query} initialQuery={query} />;
}
