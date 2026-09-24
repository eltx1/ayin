import type { NextConfig } from "next";

function configuredOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const apiOrigin = configuredOrigin(process.env.NEXT_PUBLIC_API_BASE_URL);
const mediaOrigin = configuredOrigin(process.env.NEXT_PUBLIC_MEDIA_BASE_URL);
const mediaRemotePattern = mediaOrigin ? new URL("/**", mediaOrigin) : null;
const explicitConnectOrigins = [...new Set([apiOrigin, mediaOrigin].filter(Boolean))].join(" ");
const explicitMediaOrigins = mediaOrigin ?? "";
const isProduction = process.env.NODE_ENV === "production";
const productionOnlyDirectives = isProduction ? ["upgrade-insecure-requests"] : [];

export const TIZEN_EMBED_COOKIE = "ayin_tizen_embed";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://securepubads.g.doubleclick.net https://imasdk.googleapis.com https://www.googletagservices.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${explicitMediaOrigins}`.trim(),
  `media-src 'self' blob: https: ${explicitMediaOrigins}`.trim(),
  `connect-src 'self' https: wss: ${explicitConnectOrigins}`.trim(),
  "frame-src https://securepubads.g.doubleclick.net https://*.doubleclick.net https://*.googlesyndication.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...productionOnlyDirectives,
].join("; ");

export const tizenEmbeddedContentSecurityPolicy = contentSecurityPolicy.replace(
  "frame-ancestors 'none'",
  "frame-ancestors 'self' file: tizen-widget:",
);

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
];

export const tizenEmbeddedSecurityHeaders = securityHeaders
  .filter((header) => header.key !== "X-Frame-Options")
  .map((header) =>
    header.key === "Content-Security-Policy"
      ? { ...header, value: tizenEmbeddedContentSecurityPolicy }
      : header,
  );

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@ayin/ui"],
  images: {
    remotePatterns: mediaRemotePattern ? [mediaRemotePattern] : [],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        missing: [
          { type: "query", key: "ayin_tizen_embed", value: "1" },
          { type: "cookie", key: TIZEN_EMBED_COOKIE, value: "1" },
        ],
        headers: securityHeaders,
      },
      {
        source: "/:path*",
        has: [{ type: "query", key: "ayin_tizen_embed", value: "1" }],
        headers: tizenEmbeddedSecurityHeaders,
      },
      {
        source: "/:path*",
        has: [{ type: "cookie", key: TIZEN_EMBED_COOKIE, value: "1" }],
        headers: tizenEmbeddedSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
