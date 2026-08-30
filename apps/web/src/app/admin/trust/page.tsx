import { apiFetch } from "../../../lib/api";
export default async function AdminTrustPage() {
  let data: unknown = null;
  try {
    data = await apiFetch("/admin/trust/queue");
  } catch {}
  return (
    <main>
      <h1>Trust &amp; Safety</h1>
      <p>
        Moderation reports, takedowns, cases and appeals. Destructive actions require the protected
        API and are audited.
      </p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
