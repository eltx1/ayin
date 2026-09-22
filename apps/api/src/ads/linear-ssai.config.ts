import { z } from "zod";

function emptyStringToUndefined(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const environmentSchema = z.object({
  LINEAR_SSAI_ENABLED: z.enum(["0", "1"]).default("0"),
  LINEAR_SSAI_KILL_SWITCH: z.enum(["0", "1"]).default("0"),
  LINEAR_SSAI_BREAK_DURATION_SECONDS: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(5).max(180).optional(),
  ),
  LINEAR_SEGMENT_DURATION_SECONDS: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(10).optional(),
  ),
  GAM_DAI_ENABLED: z.enum(["0", "1"]).default("0"),
  GAM_DAI_ASSET_KEY: z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._~-]{1,512}$/u)
      .optional(),
  ),
});

export interface LinearSsaiConfig {
  enabled: boolean;
  killSwitch: boolean;
  breakDurationSeconds: number | null;
  gamDaiEnabled: boolean;
  gamDaiAssetKey: string | null;
}

export function loadLinearSsaiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LinearSsaiConfig {
  const parsed = environmentSchema.parse(environment);
  const enabled = parsed.LINEAR_SSAI_ENABLED === "1";
  const gamDaiEnabled = parsed.GAM_DAI_ENABLED === "1";

  if (enabled && parsed.LINEAR_SSAI_BREAK_DURATION_SECONDS === undefined) {
    throw new Error(
      "LINEAR_SSAI_ENABLED=1 requires an explicit LINEAR_SSAI_BREAK_DURATION_SECONDS value.",
    );
  }
  const segmentDurationSeconds = parsed.LINEAR_SEGMENT_DURATION_SECONDS ?? 4;
  const maximumBreakSeconds = segmentDurationSeconds * 16;
  if (
    enabled &&
    parsed.LINEAR_SSAI_BREAK_DURATION_SECONDS !== undefined &&
    parsed.LINEAR_SSAI_BREAK_DURATION_SECONDS > maximumBreakSeconds
  ) {
    throw new Error(
      "LINEAR_SSAI_BREAK_DURATION_SECONDS must fit inside the owned HLS rolling window.",
    );
  }
  if (gamDaiEnabled && !enabled) {
    throw new Error("GAM_DAI_ENABLED=1 requires LINEAR_SSAI_ENABLED=1.");
  }
  if (gamDaiEnabled && !parsed.GAM_DAI_ASSET_KEY) {
    throw new Error("GAM_DAI_ENABLED=1 requires a real GAM_DAI_ASSET_KEY.");
  }

  return {
    enabled,
    killSwitch: parsed.LINEAR_SSAI_KILL_SWITCH === "1",
    breakDurationSeconds: parsed.LINEAR_SSAI_BREAK_DURATION_SECONDS ?? null,
    gamDaiEnabled,
    gamDaiAssetKey: parsed.GAM_DAI_ASSET_KEY ?? null,
  };
}
