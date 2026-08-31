import { AdminPayoutDetail } from "@/components/admin/admin-payout-detail";

type AdminPayoutDetailPageProps = {
  params: Promise<{ payoutId: string }>;
};

export default async function AdminPayoutDetailPage({ params }: AdminPayoutDetailPageProps) {
  const { payoutId } = await params;
  return <AdminPayoutDetail payoutId={payoutId} />;
}
