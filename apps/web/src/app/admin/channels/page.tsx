import { AdminChannels } from "@/components/admin/admin-channels";

type AdminChannelsPageProps = {
  searchParams: Promise<{ query?: string | string[] }>;
};

export default async function AdminChannelsPage({ searchParams }: AdminChannelsPageProps) {
  const params = await searchParams;
  const query = Array.isArray(params.query) ? (params.query[0] ?? "") : (params.query ?? "");
  return <AdminChannels initialQuery={query} />;
}
