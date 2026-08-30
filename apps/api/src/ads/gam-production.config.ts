import { z } from "zod";

const publisherId = /^pub-\d{16}$/;
const networkCode = /^\d{1,20}$/;

const environmentSchema = z.object({
  GAM_NETWORK_CODE: z.string().trim().regex(networkCode).optional(),
  GAM_PUBLISHER_ID: z.string().trim().regex(publisherId).optional(),
  GAM_VIDEO_AD_UNIT_PATH: z.string().trim().min(1).max(500).optional(),
  GAM_DISPLAY_AD_UNIT_PREFIX: z.string().trim().min(1).max(500).optional(),
  GAM_TEST_MODE: z.enum(["0", "1"]).default("1"),
  GAM_PRODUCTION_ENABLED: z.enum(["0", "1"]).default("0"),
  GAM_ADS_TXT_RELATIONSHIP: z.enum(["DIRECT", "RESELLER"]).optional(),
});

export interface GamProductionConfig {
  networkCode: string | null;
  publisherId: string | null;
  videoAdUnitPath: string | null;
  displayAdUnitPrefix: string | null;
  testMode: boolean;
  productionEnabled: boolean;
  adsTxtRelationship: "DIRECT" | "RESELLER" | null;
  complete: boolean;
}

export function loadGamProductionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GamProductionConfig {
  const parsed = environmentSchema.parse(environment);
  const core = [parsed.GAM_NETWORK_CODE, parsed.GAM_PUBLISHER_ID];
  const configuredCount = core.filter(Boolean).length;
  if (configuredCount > 0 && configuredCount !== core.length) {
    throw new Error("GAM_NETWORK_CODE and GAM_PUBLISHER_ID must be configured together.");
  }

  const complete = Boolean(
    parsed.GAM_NETWORK_CODE &&
      parsed.GAM_PUBLISHER_ID &&
      parsed.GAM_VIDEO_AD_UNIT_PATH &&
      parsed.GAM_DISPLAY_AD_UNIT_PREFIX,
  );
  const productionEnabled = parsed.GAM_PRODUCTION_ENABLED === "1";
  const testMode = parsed.GAM_TEST_MODE === "1";

  if (productionEnabled && !complete) {
    throw new Error(
      "GAM_PRODUCTION_ENABLED=1 requires real network, publisher, video ad unit and display ad unit configuration.",
    );
  }
  if (productionEnabled && testMode) {
    throw new Error("Disable GAM_TEST_MODE before enabling production delivery.");
  }
  if (parsed.GAM_PUBLISHER_ID && !parsed.GAM_ADS_TXT_RELATIONSHIP) {
    throw new Error("GAM_ADS_TXT_RELATIONSHIP is required when a GAM publisher ID is configured.");
  }

  return {
    networkCode: parsed.GAM_NETWORK_CODE ?? null,
    publisherId: parsed.GAM_PUBLISHER_ID ?? null,
    videoAdUnitPath: parsed.GAM_VIDEO_AD_UNIT_PATH ?? null,
    displayAdUnitPrefix: parsed.GAM_DISPLAY_AD_UNIT_PREFIX ?? null,
    testMode,
    productionEnabled,
    adsTxtRelationship: parsed.GAM_ADS_TXT_RELATIONSHIP ?? null,
    complete,
  };
}
