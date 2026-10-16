export interface CspEnvironment {
  NODE_ENV?: string | undefined;
  NEXT_PUBLIC_API_BASE_URL?: string | undefined;
  NEXT_PUBLIC_MEDIA_BASE_URL?: string | undefined;
  AYIN_CSP_REPORT_ONLY?: string | undefined;
  AYIN_CSP_UPLOAD_ORIGIN?: string | undefined;
}

// These are the entry points used by google-ima-video-ad-service and
// google-gpt-page-ad-service, including GPT's consent-preserving limited-ad SDK.
const advertisingScriptOrigins = [
  "https://securepubads.g.doubleclick.net",
  "https://imasdk.googleapis.com",
  "https://www.googletagservices.com",
  "https://pagead2.googlesyndication.com",
];

export function configuredOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uploadOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const origin = configuredOrigin(value);
  // Server-owned build configuration only. Never derive CSP trust from an API
  // upload response, user input, request Host header or a signed upload URL.
  if (!origin || origin !== value || !origin.startsWith("https://") || origin.includes("*")) {
    throw new Error("AYIN_CSP_UPLOAD_ORIGIN must be an exact HTTPS origin without a path.");
  }
  return origin;
}

export function buildContentSecurityPolicies(environment: CspEnvironment) {
  const apiOrigin = configuredOrigin(environment.NEXT_PUBLIC_API_BASE_URL);
  const mediaOrigin = configuredOrigin(environment.NEXT_PUBLIC_MEDIA_BASE_URL);
  const explicitConnectOrigins = [...new Set([apiOrigin, mediaOrigin].filter(Boolean))].join(" ");
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `script-src 'self' 'unsafe-inline' ${advertisingScriptOrigins.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https: ${mediaOrigin ?? ""}`.trim(),
    `media-src 'self' blob: https: ${mediaOrigin ?? ""}`.trim(),
    `connect-src 'self' https: wss: ${explicitConnectOrigins}`.trim(),
    "frame-src https://securepubads.g.doubleclick.net https://*.doubleclick.net https://*.googlesyndication.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  const enforced = [
    ...directives,
    ...(environment.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  if (environment.AYIN_CSP_REPORT_ONLY !== "true") return { enforced, reportOnly: null };

  // Phase one inventories connections and inline event handlers without changing
  // Next's rendering/cache model. Inline framework scripts remain allowed until
  // a separately validated nonce/hash rollout; this is not a strict script CSP.
  const candidateOrigins = [
    apiOrigin,
    mediaOrigin,
    uploadOrigin(environment.AYIN_CSP_UPLOAD_ORIGIN),
    ...advertisingScriptOrigins,
  ].filter(Boolean);
  const reportOnly = [
    ...directives.filter((directive) => !directive.startsWith("connect-src ")),
    `connect-src 'self' ${[...new Set(candidateOrigins)].join(" ")}`.trim(),
    "script-src-attr 'none'",
  ].join("; ");
  // No reporting endpoint: violations stay in the local browser/event stream;
  // signed query strings, document paths and script samples are not uploaded.
  return { enforced, reportOnly };
}
