import { Injectable } from "@nestjs/common";

export interface LensSemanticRuntimeConfigSnapshot {
  killSwitch: boolean;
  maxProviderCallsPerMinute: number;
  providerBatchSize: number;
  maxRefreshItems: number;
  refreshStaleHours: number;
  maxVectorScan: number;
  maxSemanticCandidates: number;
  minSimilarity: number;
  maxEmbeddingTextChars: number;
}

@Injectable()
export class LensSemanticRuntimeConfig {
  snapshot(): LensSemanticRuntimeConfigSnapshot {
    return {
      killSwitch: booleanEnv("AYIN_LENS_SEMANTIC_KILL_SWITCH", true),
      maxProviderCallsPerMinute: integerEnv("AYIN_LENS_MAX_PROVIDER_CALLS_PER_MINUTE", 30, 1, 600),
      providerBatchSize: integerEnv("AYIN_LENS_PROVIDER_BATCH_SIZE", 16, 1, 64),
      maxRefreshItems: integerEnv("AYIN_LENS_MAX_REFRESH_ITEMS", 48, 1, 500),
      refreshStaleHours: integerEnv("AYIN_LENS_REFRESH_STALE_HOURS", 168, 1, 24 * 90),
      maxVectorScan: integerEnv("AYIN_LENS_MAX_VECTOR_SCAN", 750, 24, 5000),
      maxSemanticCandidates: integerEnv("AYIN_LENS_MAX_SEMANTIC_CANDIDATES", 48, 1, 96),
      minSimilarity: numberEnv("AYIN_LENS_MIN_SIMILARITY", 0.3, 0, 0.95),
      maxEmbeddingTextChars: integerEnv("AYIN_LENS_MAX_EMBEDDING_TEXT_CHARS", 2400, 256, 8000),
    };
  }
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(process.env[name] ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
