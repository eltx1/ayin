const DEFAULT_COHORT_MIN_SIZE = 20;

export function configuredCohortMinSize(): number {
  const parsed = Number(process.env.ANALYTICS_COHORT_MIN_SIZE ?? DEFAULT_COHORT_MIN_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_COHORT_MIN_SIZE;
  return Math.max(10, Math.min(1000, Math.trunc(parsed)));
}

export function cohortMilestone(
  cohortSize: number,
  retained: number | null,
  sessions: number | null = null,
  watchTimeMs: bigint | null = null,
  contentReturnProfiles: number | null = null,
) {
  if (retained === null) return null;
  const watch = Number(watchTimeMs ?? 0n);
  return {
    retainedProfiles: retained,
    retentionRate: cohortSize > 0 ? retained / cohortSize : 0,
    sessions: sessions ?? 0,
    sessionsPerRetainedProfile: retained > 0 ? (sessions ?? 0) / retained : 0,
    watchTimeMs: watch,
    averageWatchTimeMsPerRetainedProfile: retained > 0 ? Math.round(watch / retained) : 0,
    ...(contentReturnProfiles === null
      ? {}
      : {
          contentReturnProfiles,
          contentReturnRate: cohortSize > 0 ? contentReturnProfiles / cohortSize : 0,
        }),
  };
}
