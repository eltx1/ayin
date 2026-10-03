import type { Metadata } from "next";

import { StudioRevenue } from "@/components/studio/studio-revenue";

export const metadata: Metadata = {
  title: "Monetization | AYIN Creator Studio",
};

export default function StudioMonetizationPage() {
  return (
    <>
      <StudioRevenue />
    </>
  );
}
