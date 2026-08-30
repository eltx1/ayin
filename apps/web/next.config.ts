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
const explicitConnectOrigins = [...new Set([apiOrigin, mediaOrigin].filter(Boolean))].join(" ");
const explicitMediaOrigins = mediaOrigin ?? "";
const productionOnlyDirectives =
  process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : [];

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

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ayin/ui"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
