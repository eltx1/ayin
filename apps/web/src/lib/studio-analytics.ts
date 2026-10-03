type Breakdown = {
  available: boolean;
  coverage: number;
  items: Array<{ value: string; count: number }>;
};

type CohortMilestone = {
  retainedProfiles: number;
  retentionRate: number;
  sessions: number;
  sessionsPerRetainedProfile: number;
  watchTimeMs: number;
  averageWatchTimeMsPerRetainedProfile: number;
  contentReturnProfiles?: number;
  contentReturnRate?: number;
};

export type CreatorAnalytics = {
  periodDays: number;
  dateRange: { from: string; to: string; timezone: "UTC" };
  refresh: "rollup";
  lastRollupCheck: string | null;
  freshnessNote: string;
  views: number;
  uniqueViewersApprox: number;
  uniqueViewerMethod: string;
  watchTimeMs: number;
  averageViewDurationMs: number;
  completionRate: number;
  subscribersGained: number;
  subscribersTotal: number;
  retention: {
    available: boolean;
    coverage: number;
    buckets: Array<{
      bucket: string;
      threshold: number;
      viewers: number;
      rate: number;
    }>;
  };
  trafficSources: Breakdown;
  devices: Breakdown;
  geography: Breakdown & { note: string };
  topVideos: Array<{ videoId: string; title: string; views: number }>;
  playbackQuality: {
    available: boolean;
    protocols: Breakdown;
    startup: {
      available: boolean;
      sampleCount: number;
      averageMs: number | null;
    };
    buffering: {
      events: number;
      measuredDurationSamples: number;
      totalDurationMs: number;
      averageDurationMs: number | null;
      eventsPerView: number;
    };
    hlsFatalEvents: number;
    mp4FallbackEvents: number;
    qualitySwitchEvents: number;
  };
  advertising: {
    available: boolean;
    opportunities: number | null;
    fills: number | null;
    fillRate: number | null;
    note: string;
  };
  cohorts: {
    minimumCohortSize: number;
    identityScope: "SIGNED_IN_PROFILE_PSEUDONYMS";
    privacyNote: string;
    audienceDaily: Array<{
      date: string;
      activeProfiles: number;
      newProfiles: number;
      returningProfiles: number;
      returningRate: number;
      sessions: number;
      sessionsPerActiveProfile: number;
      watchTimeMs: number;
      contentReturnProfiles: number;
      contentReturnRate: number;
    }>;
    retention: Array<{
      cohortDate: string;
      cohortSize: number;
      d1: CohortMilestone | null;
      d7: CohortMilestone | null;
      d30: CohortMilestone | null;
    }>;
    subscriberTrackingStartedAt: string | null;
    subscriberRetention: Array<{
      cohortDate: string;
      cohortSize: number;
      d1: CohortMilestone | null;
      d7: CohortMilestone | null;
      d30: CohortMilestone | null;
    }>;
  };
};

const invalid = () => new Error("Invalid creator analytics response");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 2000) {
  if (typeof value !== "string" || value.length > maximum) throw invalid();
  return value;
}
function bool(value: unknown) {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function number(value: unknown, integer = false, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum ||
    (integer && !Number.isSafeInteger(value))
  )
    throw invalid();
  return value;
}
const count = (value: unknown) => number(value, true);
const rate = (value: unknown) => number(value, false, 1);
function counters<T extends string>(
  row: Record<string, unknown>,
  keys: readonly T[],
): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, count(row[key])])) as Record<T, number>;
}
function date(value: unknown) {
  const result = text(value, 32),
    time = Date.parse(result);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== result) throw invalid();
  return result;
}
const nullableDate = (value: unknown) => (value === null ? null : date(value));
function id(value: unknown) {
  const result = text(value, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result))
    throw invalid();
  return result;
}
function array<T>(value: unknown, maximum: number, parse: (value: unknown) => T) {
  if (!Array.isArray(value) || value.length > maximum) throw invalid();
  return value.map(parse);
}
function unique(values: readonly string[]) {
  if (new Set(values).size !== values.length) throw invalid();
}
function breakdown(value: unknown, maximum: number): Breakdown {
  const row = object(value),
    items = array(row.items, maximum, (value) => {
      const item = object(value);
      return { value: text(item.value, 200), count: count(item.count) };
    });
  unique(items.map((item) => item.value));
  const available = bool(row.available);
  if (available !== items.reduce((sum, item) => sum + item.count, 0) > 0) throw invalid();
  return { available, coverage: rate(row.coverage), items };
}
function milestone(value: unknown, size: number): CohortMilestone | null {
  if (value === null) return null;
  const row = object(value),
    retainedProfiles = count(row.retainedProfiles);
  if (retainedProfiles > size) throw invalid();
  const result: CohortMilestone = {
    retainedProfiles,
    retentionRate: rate(row.retentionRate),
    sessions: count(row.sessions),
    sessionsPerRetainedProfile: number(row.sessionsPerRetainedProfile),
    watchTimeMs: count(row.watchTimeMs),
    averageWatchTimeMsPerRetainedProfile: count(row.averageWatchTimeMsPerRetainedProfile),
  };
  if (row.contentReturnProfiles !== undefined || row.contentReturnRate !== undefined) {
    result.contentReturnProfiles = count(row.contentReturnProfiles);
    result.contentReturnRate = rate(row.contentReturnRate);
    if (result.contentReturnProfiles > size) throw invalid();
  }
  return result;
}
export function parseStudioAnalytics(value: unknown, requestedDays: number): CreatorAnalytics {
  const row = object(value),
    range = object(row.dateRange);
  const periodDays = count(row.periodDays),
    from = date(range.from),
    to = date(range.to);
  if (
    periodDays !== requestedDays ||
    periodDays < 1 ||
    periodDays > 365 ||
    range.timezone !== "UTC" ||
    Date.parse(from) % 86400000 !== 0 ||
    Date.parse(to) % 86400000 !== 0 ||
    row.refresh !== "rollup" ||
    Date.parse(to) - Date.parse(from) !== periodDays * 86400000
  )
    throw invalid();
  const retentionRow = object(row.retention);
  const buckets = array(retentionRow.buckets, 5, (value) => {
    const item = object(value);
    return {
      bucket: text(item.bucket, 20),
      threshold: rate(item.threshold),
      viewers: count(item.viewers),
      rate: rate(item.rate),
    };
  });
  unique(buckets.map((item) => item.bucket));
  const topVideos = array(row.topVideos, 10, (value) => {
    const item = object(value);
    return { videoId: id(item.videoId), title: text(item.title), views: count(item.views) };
  });
  unique(topVideos.map((item) => item.videoId));
  const playback = object(row.playbackQuality),
    startup = object(playback.startup),
    buffering = object(playback.buffering);
  const sampleCount = count(startup.sampleCount),
    startupAvailable = bool(startup.available),
    averageMs = startup.averageMs === null ? null : count(startup.averageMs);
  if (startupAvailable !== sampleCount > 0 || (sampleCount === 0) !== (averageMs === null))
    throw invalid();
  const bufferSamples = count(buffering.measuredDurationSamples),
    averageDurationMs =
      buffering.averageDurationMs === null ? null : count(buffering.averageDurationMs);
  if ((bufferSamples === 0) !== (averageDurationMs === null)) throw invalid();
  const advertising = object(row.advertising),
    adsAvailable = bool(advertising.available);
  const opportunities =
      advertising.opportunities === null ? null : count(advertising.opportunities),
    fills = advertising.fills === null ? null : count(advertising.fills),
    fillRate = advertising.fillRate === null ? null : rate(advertising.fillRate);
  if (
    adsAvailable
      ? opportunities === null || opportunities < 1 || fills === null || fillRate === null
      : opportunities !== null || fills !== null || fillRate !== null
  )
    throw invalid();
  const cohorts = object(row.cohorts),
    minimumCohortSize = count(cohorts.minimumCohortSize);
  if (
    minimumCohortSize < 10 ||
    minimumCohortSize > 1000 ||
    cohorts.identityScope !== "SIGNED_IN_PROFILE_PSEUDONYMS"
  )
    throw invalid();
  function inRange(value: unknown) {
    const result = date(value),
      time = Date.parse(result);
    if (time % 86400000 !== 0 || time < Date.parse(from) || time >= Date.parse(to)) throw invalid();
    return result;
  }
  function cohort(value: unknown) {
    const item = object(value),
      cohortSize = count(item.cohortSize);
    if (cohortSize < minimumCohortSize) throw invalid();
    return {
      cohortDate: inRange(item.cohortDate),
      cohortSize,
      d1: milestone(item.d1, cohortSize),
      d7: milestone(item.d7, cohortSize),
      d30: milestone(item.d30, cohortSize),
    };
  }
  const audienceDaily = array(cohorts.audienceDaily, periodDays, (value) => {
    const item = object(value),
      values = counters(item, [
        "activeProfiles",
        "newProfiles",
        "returningProfiles",
        "sessions",
        "watchTimeMs",
        "contentReturnProfiles",
      ] as const);
    if (
      values.activeProfiles < minimumCohortSize ||
      values.newProfiles > values.activeProfiles ||
      values.returningProfiles > values.activeProfiles ||
      values.contentReturnProfiles > values.activeProfiles
    )
      throw invalid();
    return {
      date: inRange(item.date),
      ...values,
      returningRate: rate(item.returningRate),
      sessionsPerActiveProfile: number(item.sessionsPerActiveProfile),
      contentReturnRate: rate(item.contentReturnRate),
    };
  });
  const audienceRetention = array(cohorts.retention, periodDays, cohort),
    subscriberRetention = array(cohorts.subscriberRetention, periodDays, cohort);
  unique(audienceDaily.map((item) => item.date));
  unique(audienceRetention.map((item) => item.cohortDate));
  unique(subscriberRetention.map((item) => item.cohortDate));
  return {
    periodDays,
    dateRange: { from, to, timezone: "UTC" },
    refresh: "rollup",
    lastRollupCheck: nullableDate(row.lastRollupCheck),
    freshnessNote: text(row.freshnessNote),
    ...counters(row, [
      "views",
      "uniqueViewersApprox",
      "watchTimeMs",
      "averageViewDurationMs",
      "subscribersGained",
      "subscribersTotal",
    ] as const),
    uniqueViewerMethod: text(row.uniqueViewerMethod),
    completionRate: rate(row.completionRate),
    retention: {
      available: bool(retentionRow.available),
      coverage: rate(retentionRow.coverage),
      buckets,
    },
    trafficSources: breakdown(row.trafficSources, 12),
    devices: breakdown(row.devices, 12),
    geography: { ...breakdown(row.geography, 20), note: text(object(row.geography).note) },
    topVideos,
    playbackQuality: {
      available: bool(playback.available),
      protocols: breakdown(playback.protocols, 12),
      startup: { available: startupAvailable, sampleCount, averageMs },
      buffering: {
        events: count(buffering.events),
        measuredDurationSamples: bufferSamples,
        totalDurationMs: count(buffering.totalDurationMs),
        averageDurationMs,
        eventsPerView: number(buffering.eventsPerView),
      },
      ...counters(playback, [
        "hlsFatalEvents",
        "mp4FallbackEvents",
        "qualitySwitchEvents",
      ] as const),
    },
    advertising: {
      available: adsAvailable,
      opportunities,
      fills,
      fillRate,
      note: text(advertising.note),
    },
    cohorts: {
      minimumCohortSize,
      identityScope: "SIGNED_IN_PROFILE_PSEUDONYMS",
      privacyNote: text(cohorts.privacyNote),
      audienceDaily,
      retention: audienceRetention,
      subscriberRetention,
      subscriberTrackingStartedAt: nullableDate(cohorts.subscriberTrackingStartedAt),
    },
  };
}
