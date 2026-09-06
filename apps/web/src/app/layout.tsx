import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { InstallUpdateController } from "@/components/pwa/install-update-controller";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { TvPlatformRuntime } from "@/components/platform/tv-platform-runtime";
import {
  absoluteUrl,
  AYIN_DEFAULT_DESCRIPTION,
  AYIN_DEFAULT_IMAGE,
  AYIN_NAME,
  AYIN_SITE_URL,
  metadataRobots,
  serializeJsonLd,
} from "@/lib/seo";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(AYIN_SITE_URL),
  applicationName: AYIN_NAME,
  category: "entertainment",
  description: AYIN_DEFAULT_DESCRIPTION,
  icons: {
    icon: "/brand/ayin-logo.png",
    apple: "/brand/ayin-logo.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: AYIN_NAME,
    title: AYIN_NAME,
    description: AYIN_DEFAULT_DESCRIPTION,
    url: AYIN_SITE_URL,
    images: [{ url: AYIN_DEFAULT_IMAGE, alt: "AYIN" }],
  },
  robots: metadataRobots(true),
  title: {
    default: "AYIN — Watch, Stream & Discover",
    template: "%s | AYIN",
  },
  twitter: {
    card: "summary_large_image",
    title: AYIN_NAME,
    description: AYIN_DEFAULT_DESCRIPTION,
    images: [AYIN_DEFAULT_IMAGE],
  },
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }
    : {}),
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#03030a",
};

interface RootLayoutProperties {
  children: ReactNode;
}

const siteStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": absoluteUrl("/#organization"),
      name: AYIN_NAME,
      url: AYIN_SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/brand/ayin-logo.png"),
      },
    },
    {
      "@type": "WebSite",
      "@id": absoluteUrl("/#website"),
      url: AYIN_SITE_URL,
      name: AYIN_NAME,
      description: AYIN_DEFAULT_DESCRIPTION,
      publisher: { "@id": absoluteUrl("/#organization") },
    },
  ],
};

export default function RootLayout({ children }: RootLayoutProperties) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteStructuredData) }}
        />
        <ServiceWorkerRegistration />
        <InstallUpdateController />
        <TvPlatformRuntime />
        {children}
      </body>
    </html>
  );
}
