import type { Metadata } from "next";

import { AdminSettingsPanel } from "./admin-settings-panel";

export const metadata: Metadata = {
  title: "Platform Settings | AYIN Admin",
};

export default function AdminSettingsPage() {
  return <AdminSettingsPanel />;
}
