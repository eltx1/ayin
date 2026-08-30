"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl } from "../../../lib/api";

export default function AdminTrustPage() {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/admin/trust/queue`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("REQUEST_FAILED")),
      )
      .then(setData)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
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
