import { apiFetch } from "../../../lib/api";
export default async function StudioTrustPage() {
  let data: any = null;
  try {
    data = await apiFetch("/trust/creator/history");
  } catch {}
  return (
    <main>
      <h1>Trust &amp; Safety</h1>
      <p>Your moderation notices, trust status and appeal history.</p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
