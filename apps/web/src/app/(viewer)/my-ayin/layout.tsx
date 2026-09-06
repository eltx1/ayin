import type { Metadata } from "next";
import type { ReactNode } from "react";

import { metadataRobots } from "@/lib/seo";

export const metadata: Metadata = {
  robots: metadataRobots(false),
};

export default function MyAyinLayout({ children }: { children: ReactNode }) {
  return children;
}
