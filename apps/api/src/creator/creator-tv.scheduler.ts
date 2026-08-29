export type CreatorTvRotationMode = "PRIORITY_ORDER_OLDEST" | "PRIORITY_ORDER_NEWEST";

export interface CreatorTvLibraryItem<T = unknown> {
  id: string;
  durationMs: number | null;
  priority: number;
  sortOrder: number | null;
  publishedAtMs: number;
  payload: T;
}

export interface CreatorTvScheduledProgram<T = unknown> {
  occurrence: number;
  occurrenceKey: string;
  item: CreatorTvLibraryItem<T>;
  startsAtMs: number;
  endsAtMs: number;
  playbackOffsetMs: number;
  source: "AUTO";
}

export interface CreatorTvSchedule<T = unknown> {
  cycleDurationMs: number;
  nowPlaying: CreatorTvScheduledProgram<T> | null;
  upNext: CreatorTvScheduledProgram<T> | null;
  guide: CreatorTvScheduledProgram<T>[];
  windowEndsAtMs: number;
}

export interface BuildCreatorTvScheduleInput<T = unknown> {
  epochMs: number;
  nowMs: number;
  windowMs: number;
  fallbackDurationMs: number;
  rotationMode: CreatorTvRotationMode;
  items: CreatorTvLibraryItem<T>[];
  maxPrograms?: number;
}

interface OrderedDuration<T> {
  item: CreatorTvLibraryItem<T>;
  durationMs: number;
}

const DEFAULT_MAX_PROGRAMS = 96;

export function orderCreatorTvLibrary<T>(
  items: CreatorTvLibraryItem<T>[],
  rotationMode: CreatorTvRotationMode,
): CreatorTvLibraryItem<T>[] {
  return [...items].sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority;

    const leftOrdered = left.sortOrder !== null;
    const rightOrdered = right.sortOrder !== null;
    if (leftOrdered !== rightOrdered) return leftOrdered ? -1 : 1;
    if (left.sortOrder !== null && right.sortOrder !== null && left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    if (left.publishedAtMs !== right.publishedAtMs) {
      return rotationMode === "PRIORITY_ORDER_NEWEST"
        ? right.publishedAtMs - left.publishedAtMs
        : left.publishedAtMs - right.publishedAtMs;
    }
    return left.id.localeCompare(right.id);
  });
}

export function buildCreatorTvSchedule<T>(
  input: BuildCreatorTvScheduleInput<T>,
): CreatorTvSchedule<T> {
  assertPositiveSafeInteger(input.fallbackDurationMs, "fallbackDurationMs");
  assertPositiveSafeInteger(input.windowMs, "windowMs");

  const maxPrograms = input.maxPrograms ?? DEFAULT_MAX_PROGRAMS;
  assertPositiveSafeInteger(maxPrograms, "maxPrograms");

  const ordered = orderCreatorTvLibrary(input.items, input.rotationMode).map((item) => ({
    item,
    durationMs: validDuration(item.durationMs) ? item.durationMs : input.fallbackDurationMs,
  })) satisfies OrderedDuration<T>[];

  const windowEndsAtMs = input.nowMs + input.windowMs;
  if (ordered.length === 0) {
    return {
      cycleDurationMs: 0,
      nowPlaying: null,
      upNext: null,
      guide: [],
      windowEndsAtMs,
    };
  }

  const cycleDurationMs = ordered.reduce((total, entry) => total + entry.durationMs, 0);
  if (!Number.isSafeInteger(cycleDurationMs) || cycleDurationMs <= 0) {
    throw new Error("Creator TV cycle duration is outside the supported V1 range.");
  }

  const elapsedMs = Math.max(0, input.nowMs - input.epochMs);
  const cycleNumber = Math.floor(elapsedMs / cycleDurationMs);
  const offsetInCycleMs = elapsedMs % cycleDurationMs;

  let itemIndex = 0;
  let cumulativeMs = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    if (!candidate) break;
    if (offsetInCycleMs < cumulativeMs + candidate.durationMs) {
      itemIndex = index;
      break;
    }
    cumulativeMs += candidate.durationMs;
  }

  let occurrence = cycleNumber * ordered.length + itemIndex;
  let startsAtMs = input.epochMs + cycleNumber * cycleDurationMs + cumulativeMs;
  const guide: CreatorTvScheduledProgram<T>[] = [];

  for (let count = 0; count < maxPrograms; count += 1) {
    const entry = ordered[itemIndex];
    if (!entry) break;
    const endsAtMs = startsAtMs + entry.durationMs;
    if (guide.length > 0 && startsAtMs >= windowEndsAtMs) break;

    guide.push({
      occurrence,
      occurrenceKey: `${entry.item.id}:${occurrence}`,
      item: entry.item,
      startsAtMs,
      endsAtMs,
      playbackOffsetMs:
        guide.length === 0 && input.nowMs >= startsAtMs && input.nowMs < endsAtMs
          ? input.nowMs - startsAtMs
          : 0,
      source: "AUTO",
    });

    startsAtMs = endsAtMs;
    occurrence += 1;
    itemIndex = (itemIndex + 1) % ordered.length;
  }

  const nowPlaying =
    guide.find((program) => program.startsAtMs <= input.nowMs && input.nowMs < program.endsAtMs) ??
    null;
  const currentIndex = nowPlaying
    ? guide.findIndex((program) => program.occurrenceKey === nowPlaying.occurrenceKey)
    : -1;
  const upNext = currentIndex >= 0 ? (guide[currentIndex + 1] ?? null) : (guide[0] ?? null);

  return {
    cycleDurationMs,
    nowPlaying,
    upNext,
    guide,
    windowEndsAtMs,
  };
}

function validDuration(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}
