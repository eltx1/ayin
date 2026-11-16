export function androidAssetLinks(raw: string | undefined): unknown[] | null {
  if (!raw) return null;
  try {
    const fingerprints: unknown = JSON.parse(raw);
    if (
      !Array.isArray(fingerprints) ||
      fingerprints.length === 0 ||
      fingerprints.length > 10 ||
      fingerprints.some(
        (value) =>
          typeof value !== "string" || !/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(value),
      )
    )
      return null;
    return [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "net.ayin.app.mobile",
          sha256_cert_fingerprints: [
            ...new Set(fingerprints.map((value: string) => value.toUpperCase())),
          ],
        },
      },
    ];
  } catch {
    return null;
  }
}
export function appleAppLinks(teamId: string | undefined): Record<string, unknown> | null {
  if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId)) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [teamId + ".net.ayin.app.ios"],
          components: [
            { "/": "/watch/*" },
            { "/": "/c/*" },
            { "/": "/clips" },
            { "/": "/notifications" },
            { "/": "/ar/watch/*" },
            { "/": "/ar/c/*" },
            { "/": "/ar/clips" },
            { "/": "/ar/notifications" },
            { "/": "/en/watch/*" },
            { "/": "/en/c/*" },
            { "/": "/en/clips" },
            { "/": "/en/notifications" },
          ],
        },
      ],
    },
  };
}
