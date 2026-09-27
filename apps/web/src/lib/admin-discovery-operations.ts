import { apiBaseUrl } from "./api";
import { readAdminApiError } from "./admin-reauthentication";

export const metricLabels = {
  precisionProxy: ["Precision proxy", "مؤشر الدقة"],
  recallProxy: ["Recall proxy", "مؤشر الاسترجاع"],
  watchTimeRelevance: ["Watch-time relevance", "ملاءمة وقت المشاهدة"],
  completionRate: ["Completion", "الإكمال"],
  diversity: ["Topic diversity", "تنوع الموضوعات"],
  creatorDiversity: ["Creator diversity", "تنوع المبدعين"],
  catalogDiversity: ["Catalog diversity", "تنوع أنواع المحتوى"],
  novelty: ["Novelty", "الجِدّة"],
  repeatedItemRate: ["Repeated items", "تكرار العناصر"],
} as const;
export type EvaluationMetric = keyof typeof metricLabels;
export type FixtureMetrics = Record<EvaluationMetric, number> & {
  versionId: string;
  cases: number;
  evaluatedPositions: number;
};
export interface FixtureEvaluation {
  fixtureId: string;
  baseline: FixtureMetrics;
  candidate: FixtureMetrics;
  releaseAssessment: { pass: boolean; blockers: string[]; delta: Record<EvaluationMetric, number> };
}
export interface ObservedVersion {
  versionId: string;
  algorithmId: string;
  surface: string;
  mode: string;
  exposures: number;
  firstSeenAt: string;
  lastSeenAt: string;
}
export interface ObservedSample {
  versions: string[];
  telemetryCoverage: number;
  exposures: Array<{
    exposureId: string;
    versionId: string;
    surface: string;
    mode: string;
    createdAt: string;
    outcomes: Array<{
      videoId: string;
      impression: boolean;
      clicked: boolean;
      watchTimeMs: number;
      completed: boolean;
    }>;
  }>;
}
export const trendingFields = [
  {
    key: "windowHours",
    en: "Ranking window (hours)",
    ar: "نافذة الترتيب (ساعات)",
    min: 24,
    max: 168,
    step: 1,
  },
  {
    key: "recentHours",
    en: "Recent activity window (hours)",
    ar: "نافذة النشاط الحديث (ساعات)",
    min: 1,
    max: 24,
    step: 1,
  },
  {
    key: "halfLifeHours",
    en: "Recency half-life (hours)",
    ar: "نصف عمر الحداثة (ساعات)",
    min: 2,
    max: 72,
    step: 0.1,
  },
  {
    key: "minAudienceGlobal",
    en: "Minimum global audience",
    ar: "الحد الأدنى للجمهور العالمي",
    min: 3,
    max: 1000,
    step: 1,
  },
  {
    key: "minAudienceRegional",
    en: "Minimum regional audience",
    ar: "الحد الأدنى للجمهور الإقليمي",
    min: 20,
    max: 2000,
    step: 1,
  },
  {
    key: "minQualifiedWatchMs",
    en: "Qualified viewing minimum (ms)",
    ar: "الحد الأدنى للمشاهدة المؤهلة (مللي ثانية)",
    min: 1000,
    max: 60000,
    step: 1,
  },
  {
    key: "perSessionWatchCapMs",
    en: "Watch cap per session (ms)",
    ar: "حد المشاهدة لكل جلسة (مللي ثانية)",
    min: 60000,
    max: 3600000,
    step: 1,
  },
  {
    key: "maxVelocityMultiplier",
    en: "Maximum velocity multiplier",
    ar: "الحد الأقصى لمضاعف النمو",
    min: 1,
    max: 10,
    step: 0.1,
  },
  {
    key: "maxCandidates",
    en: "Maximum candidates",
    ar: "الحد الأقصى للمرشحين",
    min: 20,
    max: 500,
    step: 1,
  },
  {
    key: "snapshotLimit",
    en: "Snapshot item limit",
    ar: "حد العناصر في اللقطة",
    min: 10,
    max: 200,
    step: 1,
  },
] as const;
export const weightLabels = {
  qualifiedViews: ["Qualified views", "المشاهدات المؤهلة"],
  watchTime: ["Watch time", "وقت المشاهدة"],
  completion: ["Completion", "الإكمال"],
  velocity: ["Growth velocity", "سرعة النمو"],
  uniqueSessions: ["Unique sessions", "الجلسات الفريدة"],
  recency: ["Recency", "الحداثة"],
  negativeQuality: ["Negative quality penalty", "عقوبة الجودة السلبية"],
} as const;
export type TrendingField = (typeof trendingFields)[number]["key"];
export type TrendingWeight = keyof typeof weightLabels;
export type TrendingConfig = Record<TrendingField, number> & {
  weights: Record<TrendingWeight, number>;
};

export function validTrending(config: TrendingConfig): boolean {
  return (
    trendingFields.every(
      ({ key, min, max, step }) =>
        Number.isFinite(config[key]) &&
        config[key] >= min &&
        config[key] <= max &&
        (step !== 1 || Number.isInteger(config[key])),
    ) &&
    Object.keys(weightLabels).every(
      (key) =>
        Number.isFinite(config.weights[key as TrendingWeight]) &&
        config.weights[key as TrendingWeight] >= 0 &&
        config.weights[key as TrendingWeight] <= 3,
    ) &&
    config.recentHours < config.windowHours &&
    config.minAudienceRegional >= config.minAudienceGlobal &&
    Object.entries(config.weights)
      .filter(([key]) => key !== "negativeQuality")
      .some(([, value]) => value > 0)
  );
}
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await readAdminApiError(response));
  return response.json() as Promise<T>;
}
export const getFixtureEvaluation = (candidate: "balanced" | "watch-only", signal: AbortSignal) =>
  read<FixtureEvaluation>(
    `/admin/recommendation-evaluation/fixed-fixture?baselineVersionId=baseline&candidateVersionId=${candidate}`,
    signal,
  );
export const getObservedVersions = (signal: AbortSignal) =>
  read<ObservedVersion[]>("/admin/recommendation-evaluation/versions?days=30", signal);
export async function getTrendingConfig(signal: AbortSignal): Promise<TrendingConfig> {
  return parseTrending(await read<unknown>("/admin/trending-settings", signal));
}
function parseTrending(value: unknown): TrendingConfig {
  if (
    !value ||
    typeof value !== "object" ||
    !("weights" in value) ||
    !value.weights ||
    typeof value.weights !== "object" ||
    !validTrending(value as TrendingConfig)
  )
    throw new Error("Trending configuration could not be verified.");
  return value as TrendingConfig;
}
export async function getObservedSample(
  versionId: string,
  signal: AbortSignal,
): Promise<ObservedSample> {
  if (!versionId.trim() || versionId.length > 120 || versionId.includes(","))
    throw new Error("Choose one observed recommendation version.");
  return read<ObservedSample>(
    `/admin/recommendation-evaluation/export?${new URLSearchParams({ versionIds: versionId, days: "14", limit: "100" })}`,
    signal,
  );
}
export async function saveTrendingConfig(
  config: TrendingConfig,
  reason: string,
  signal: AbortSignal,
): Promise<TrendingConfig> {
  if (!validTrending(config) || reason.trim().length < 3 || reason.trim().length > 500)
    throw new Error("Check the ranking limits and provide a reason of 3–500 characters.");
  const response = await fetch(`${apiBaseUrl}/admin/trending-settings`, {
    method: "PUT",
    credentials: "include",
    cache: "no-store",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config, reason: reason.trim() }),
  });
  if (!response.ok) throw new Error(await readAdminApiError(response));
  return parseTrending(await response.json());
}
export function summarizeObserved(sample: ObservedSample) {
  return sample.exposures.reduce(
    (summary, exposure) => {
      for (const outcome of exposure.outcomes) {
        summary.impressions += Number(outcome.impression);
        summary.clicks += Number(outcome.clicked);
        summary.completions += Number(outcome.completed);
        summary.watchTimeMs += outcome.watchTimeMs;
      }
      return summary;
    },
    { impressions: 0, clicks: 0, completions: 0, watchTimeMs: 0 },
  );
}
