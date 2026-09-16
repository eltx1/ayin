export interface RecommendationEvaluationItemMetadata {
  creatorId: string;
  catalogKey: string;
  topicKey: string;
  durationMs: number;
}

export interface RecommendationEvaluationOutcome {
  clicked?: boolean;
  watchTimeMs?: number;
  completed?: boolean;
}

export interface RecommendationEvaluationCase {
  caseId: string;
  rankings: Record<string, string[]>;
  itemMetadata: Record<string, RecommendationEvaluationItemMetadata>;
  outcomes: Record<string, RecommendationEvaluationOutcome>;
  relevantVideoIds?: string[];
  priorSeenVideoIds?: string[];
  recentRecommendationIds?: string[];
}

export interface RecommendationEvaluationFixture {
  fixtureId: string;
  cases: RecommendationEvaluationCase[];
}

export interface RecommendationEvaluationMetrics {
  versionId: string;
  fixtureId: string;
  cases: number;
  evaluatedPositions: number;
  precisionProxy: number;
  recallProxy: number;
  watchTimeRelevance: number;
  completionRate: number;
  diversity: number;
  creatorDiversity: number;
  catalogDiversity: number;
  novelty: number;
  repeatedItemRate: number;
}

export interface RecommendationEvaluationDelta {
  baselineVersionId: string;
  candidateVersionId: string;
  precisionProxy: number;
  recallProxy: number;
  watchTimeRelevance: number;
  completionRate: number;
  diversity: number;
  creatorDiversity: number;
  catalogDiversity: number;
  novelty: number;
  repeatedItemRate: number;
}

export interface RecommendationReleaseGuardrails {
  minimumPrecisionDelta: number;
  minimumRecallDelta: number;
  minimumWatchTimeDelta: number;
  minimumCompletionDelta: number;
  minimumDiversityDelta: number;
  minimumCreatorDiversityDelta: number;
  minimumCatalogDiversityDelta: number;
  minimumNoveltyDelta: number;
  maximumRepeatedItemRateIncrease: number;
}

export interface RecommendationReleaseAssessment {
  pass: boolean;
  blockers: string[];
  delta: RecommendationEvaluationDelta;
}

export const defaultRecommendationReleaseGuardrails: RecommendationReleaseGuardrails = {
  minimumPrecisionDelta: -0.05,
  minimumRecallDelta: -0.05,
  minimumWatchTimeDelta: -0.05,
  minimumCompletionDelta: -0.05,
  minimumDiversityDelta: -0.1,
  minimumCreatorDiversityDelta: -0.1,
  minimumCatalogDiversityDelta: -0.1,
  minimumNoveltyDelta: -0.1,
  maximumRepeatedItemRateIncrease: 0.1,
};

export function evaluateRecommendationVersion(
  fixture: RecommendationEvaluationFixture,
  versionId: string,
  cutoff = 10,
): RecommendationEvaluationMetrics {
  const safeCutoff = Math.max(1, Math.floor(cutoff));
  let evaluatedPositions = 0;
  let precision = 0;
  let recall = 0;
  let watchTime = 0;
  let completion = 0;
  let diversity = 0;
  let creatorDiversity = 0;
  let catalogDiversity = 0;
  let novelty = 0;
  let repeated = 0;
  let evaluatedCases = 0;

  for (const evaluationCase of fixture.cases) {
    const ranked = (evaluationCase.rankings[versionId] ?? []).slice(0, safeCutoff);
    if (!ranked.length) continue;
    evaluatedCases += 1;
    evaluatedPositions += ranked.length;

    const explicitRelevant = new Set(evaluationCase.relevantVideoIds ?? []);
    const relevant =
      explicitRelevant.size > 0 ? explicitRelevant : observedRelevant(evaluationCase);
    const hits = ranked.filter((videoId) => relevant.has(videoId)).length;
    precision += hits / ranked.length;
    recall += relevant.size > 0 ? hits / relevant.size : 0;

    let caseWatch = 0;
    let caseCompleted = 0;
    const creators = new Set<string>();
    const catalogs = new Set<string>();
    const topics = new Set<string>();
    const priorSeen = new Set(evaluationCase.priorSeenVideoIds ?? []);
    const recentRecommendations = new Set(evaluationCase.recentRecommendationIds ?? []);
    const withinList = new Set<string>();
    let caseNovel = 0;
    let caseRepeated = 0;

    for (const videoId of ranked) {
      const metadata = evaluationCase.itemMetadata[videoId];
      const outcome = evaluationCase.outcomes[videoId] ?? {};
      if (metadata) {
        creators.add(metadata.creatorId);
        catalogs.add(metadata.catalogKey);
        topics.add(metadata.topicKey);
        const duration = finitePositive(metadata.durationMs);
        const watched = finiteNonNegative(outcome.watchTimeMs ?? 0);
        caseWatch += duration > 0 ? clamp(watched / duration, 0, 1) : 0;
      }
      if (outcome.completed === true) caseCompleted += 1;
      if (!priorSeen.has(videoId)) caseNovel += 1;
      if (withinList.has(videoId) || recentRecommendations.has(videoId)) caseRepeated += 1;
      withinList.add(videoId);
    }

    watchTime += caseWatch / ranked.length;
    completion += caseCompleted / ranked.length;
    creatorDiversity += creators.size / ranked.length;
    catalogDiversity += catalogs.size / ranked.length;
    diversity += topics.size / ranked.length;
    novelty += caseNovel / ranked.length;
    repeated += caseRepeated / ranked.length;
  }

  const denominator = Math.max(1, evaluatedCases);
  return {
    versionId,
    fixtureId: fixture.fixtureId,
    cases: evaluatedCases,
    evaluatedPositions,
    precisionProxy: round(precision / denominator),
    recallProxy: round(recall / denominator),
    watchTimeRelevance: round(watchTime / denominator),
    completionRate: round(completion / denominator),
    diversity: round(diversity / denominator),
    creatorDiversity: round(creatorDiversity / denominator),
    catalogDiversity: round(catalogDiversity / denominator),
    novelty: round(novelty / denominator),
    repeatedItemRate: round(repeated / denominator),
  };
}

export function compareRecommendationVersions(
  baseline: RecommendationEvaluationMetrics,
  candidate: RecommendationEvaluationMetrics,
): RecommendationEvaluationDelta {
  if (baseline.fixtureId !== candidate.fixtureId) {
    throw new Error("Recommendation versions must be evaluated against the same fixture.");
  }
  return {
    baselineVersionId: baseline.versionId,
    candidateVersionId: candidate.versionId,
    precisionProxy: round(candidate.precisionProxy - baseline.precisionProxy),
    recallProxy: round(candidate.recallProxy - baseline.recallProxy),
    watchTimeRelevance: round(candidate.watchTimeRelevance - baseline.watchTimeRelevance),
    completionRate: round(candidate.completionRate - baseline.completionRate),
    diversity: round(candidate.diversity - baseline.diversity),
    creatorDiversity: round(candidate.creatorDiversity - baseline.creatorDiversity),
    catalogDiversity: round(candidate.catalogDiversity - baseline.catalogDiversity),
    novelty: round(candidate.novelty - baseline.novelty),
    repeatedItemRate: round(candidate.repeatedItemRate - baseline.repeatedItemRate),
  };
}

export function assessRecommendationRelease(
  baseline: RecommendationEvaluationMetrics,
  candidate: RecommendationEvaluationMetrics,
  guardrails: RecommendationReleaseGuardrails = defaultRecommendationReleaseGuardrails,
): RecommendationReleaseAssessment {
  const delta = compareRecommendationVersions(baseline, candidate);
  const blockers: string[] = [];
  if (delta.precisionProxy < guardrails.minimumPrecisionDelta) blockers.push("precisionProxy");
  if (delta.recallProxy < guardrails.minimumRecallDelta) blockers.push("recallProxy");
  if (delta.watchTimeRelevance < guardrails.minimumWatchTimeDelta)
    blockers.push("watchTimeRelevance");
  if (delta.completionRate < guardrails.minimumCompletionDelta) blockers.push("completionRate");
  if (delta.diversity < guardrails.minimumDiversityDelta) blockers.push("diversity");
  if (delta.creatorDiversity < guardrails.minimumCreatorDiversityDelta)
    blockers.push("creatorDiversity");
  if (delta.catalogDiversity < guardrails.minimumCatalogDiversityDelta)
    blockers.push("catalogDiversity");
  if (delta.novelty < guardrails.minimumNoveltyDelta) blockers.push("novelty");
  if (delta.repeatedItemRate > guardrails.maximumRepeatedItemRateIncrease) {
    blockers.push("repeatedItemRate");
  }
  return { pass: blockers.length === 0, blockers, delta };
}

function observedRelevant(evaluationCase: RecommendationEvaluationCase): Set<string> {
  const relevant = new Set<string>();
  for (const [videoId, outcome] of Object.entries(evaluationCase.outcomes)) {
    const metadata = evaluationCase.itemMetadata[videoId];
    const duration = finitePositive(metadata?.durationMs ?? 0);
    const watched = finiteNonNegative(outcome.watchTimeMs ?? 0);
    if (
      outcome.clicked === true ||
      outcome.completed === true ||
      (duration > 0 && watched / duration >= 0.25)
    ) {
      relevant.add(videoId);
    }
  }
  return relevant;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
