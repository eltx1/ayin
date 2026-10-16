import type { NextConfig } from "next";
import { buildContentSecurityPolicies, configuredOrigin } from "./src/lib/content-security-policy";

const mediaOrigin = configuredOrigin(process.env.NEXT_PUBLIC_MEDIA_BASE_URL);
const mediaRemotePattern = mediaOrigin ? new URL("/**", mediaOrigin) : null;
const isProduction = process.env.NODE_ENV === "production";
const contentSecurityPolicies = buildContentSecurityPolicies(process.env);

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicies.enforced },
  ...(contentSecurityPolicies.reportOnly
    ? [{ key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicies.reportOnly }]
    : []),
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
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
