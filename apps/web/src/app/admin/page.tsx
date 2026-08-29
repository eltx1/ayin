import type { Metadata } from "next";

import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const metadata: Metadata = {
  title: "Control Plane | AYIN Admin",
};

export default function AdminPage() {
  return <AdminDashboard />;
}
