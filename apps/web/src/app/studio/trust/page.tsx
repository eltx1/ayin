"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl } from "../../../lib/api";

export default function StudioTrustPage() {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/trust/creator/history`, {
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
      <p>Your moderation notices, trust status and appeal history.</p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
