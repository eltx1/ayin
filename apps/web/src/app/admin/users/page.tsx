import { AdminUsers } from "@/components/admin/admin-users";

type AdminUsersPageProps = {
  searchParams: Promise<{ query?: string | string[] }>;
};

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const params = await searchParams;
  const query = Array.isArray(params.query) ? (params.query[0] ?? "") : (params.query ?? "");
  return <AdminUsers initialQuery={query} />;
}
