import { StudioMonetizationInsights } from "@/components/studio/studio-monetization-insights";
import { StudioRevenue } from "@/components/studio/studio-revenue";

export default function StudioMonetizationPage() {
  return (
    <>
      <StudioRevenue />
      <StudioMonetizationInsights />
    </>
  );
}
