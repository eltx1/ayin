import { AdminRevenueControlCenter } from "@/components/admin/admin-revenue-control-center";
import { AdminRevenueReconciliation } from "@/components/admin/admin-revenue-reconciliation";

export default function AdminRevenuePage() {
  return (
    <>
      <AdminRevenueControlCenter />
      <AdminRevenueReconciliation />
    </>
  );
}
