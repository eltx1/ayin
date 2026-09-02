import { AdminContentLibrary } from "@/components/admin/admin-content-library";

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ channelId?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawChannelId = params.channelId;
  const requestedChannelId = Array.isArray(rawChannelId)
    ? (rawChannelId[0] ?? "")
    : (rawChannelId ?? "");
  return <AdminContentLibrary requestedChannelId={requestedChannelId} />;
}
