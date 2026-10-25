import type { DiscoveryItem, DiscoveryPage } from "./discovery.service.js";

export const AUTO_HOME_CANDIDATE_LIMIT = 96;
export const AUTO_HOME_ROW_LIMIT = 8;
const minimumDistinctSectionItems = 4;
const maximumAutomaticRows = 5;
const preferredItemsPerCreator = 2;

export type HomeMode = "AUTO" | "MANAGED";
export type HomeStatus = "READY" | "EMPTY" | "DISABLED";

export interface HomeRow extends DiscoveryPage {
  key: string;
  title: string;
  source: string;
  maxItems: number;
}

export interface HomeSpotlight extends DiscoveryItem {
  description: string | null;
  durationMs: number | null;
  channelName: string | null;
}

export interface HomeResponse {
  mode: HomeMode;
  status: HomeStatus;
  spotlight: HomeSpotlight | null;
  rows: HomeRow[];
}

export interface AutomaticHomeCandidate {
  item: DiscoveryItem;
  creatorId: string;
  contentType: "CREATOR_VIDEO" | "MOVIE" | "DOCUMENTARY";
  videoForm: "LONG_FORM" | "CLIP";
  description: string | null;
  durationMs: number | null;
  channelName: string | null;
}

/** Existing rows, even disabled ones, establish editorial ownership. */
export function resolveHomeMode(choice: unknown, hasConfiguredRows: boolean): HomeMode {
  if (choice === "AUTO" || choice === "MANAGED") return choice;
  return hasConfiguredRows ? "MANAGED" : "AUTO";
}

export function homeStatusAfterRows(
  home: Pick<HomeResponse, "spotlight" | "status">,
  rows: ReadonlyArray<{ items: readonly DiscoveryItem[] }>,
): HomeStatus {
  if (home.spotlight || rows.some((row) => row.items.length > 0)) return "READY";
  return home.status === "DISABLED" ? "DISABLED" : "EMPTY";
}

/**
 * A finite home selection, not a catalogue pagination endpoint. Candidates are
 * already policy-eligible and ordered by publication time with a stable ID tie.
 * No popularity or personal-affinity inference is made here.
 */
export function composeAutomaticHome(
  input: readonly AutomaticHomeCandidate[],
  continueWatching: readonly DiscoveryItem[] = [],
  options: { isKidsProfile?: boolean } = {},
): HomeResponse {
  const seen = new Set<string>();
  const candidates = input.slice(0, AUTO_HOME_CANDIDATE_LIMIT).filter((candidate) => {
    if (seen.has(candidate.item.id)) return false;
    seen.add(candidate.item.id);
    return true;
  });
  seen.clear();
  const creatorCounts = new Map<string, number>();
  const byId = new Map(candidates.map((candidate) => [candidate.item.id, candidate]));
  const rows: HomeRow[] = [];
  const isKids = options.isKidsProfile === true;

  const remember = (candidate: AutomaticHomeCandidate) => {
    if (seen.has(candidate.item.id)) return;
    seen.add(candidate.item.id);
    creatorCounts.set(candidate.creatorId, (creatorCounts.get(candidate.creatorId) ?? 0) + 1);
  };

  // Resume is a distinct viewer task. Preserve its actual progress order rather
  // than relabelling it as recency or suppressing it with a featured card.
  if (!isKids) {
    const resume = continueWatching.filter((item) => {
      if (seen.has(item.id) || seen.size >= AUTO_HOME_ROW_LIMIT) return false;
      const candidate = byId.get(item.id);
      if (candidate) remember(candidate);
      else seen.add(item.id);
      return true;
    });
    if (resume.length) {
      rows.push(
        finiteRow("auto-continue-watching", "Continue Watching", "CONTINUE_WATCHING", resume),
      );
    }
  }

  const remaining = () => candidates.filter((candidate) => !seen.has(candidate.item.id));
  let spotlight: HomeSpotlight | null = null;
  // The existing Kids screen consumes rows only, and must never lose its sole
  // eligible title to a spotlight that it does not render.
  if (!isKids) {
    const presentationReady = candidates.filter((candidate) =>
      Boolean(candidate.item.artworkObjectKey?.trim() && candidate.description?.trim()),
    );
    const longForm = presentationReady.filter((candidate) => candidate.videoForm === "LONG_FORM");
    const tier = longForm.length ? longForm : presentationReady;
    // Resume deduplication must not demote the spotlight to a weaker tier.
    // Prefer unseen titles within the tier; otherwise keep the resume entry
    // and reuse its catalogue metadata without counting its creator twice.
    const featured = tier.find((candidate) => !seen.has(candidate.item.id)) ?? tier[0];
    if (featured) {
      remember(featured);
      spotlight = {
        ...featured.item,
        description: featured.description,
        durationMs: featured.durationMs,
        channelName: featured.channelName,
      };
    }
  }

  const definitions = [
    { key: "auto-movies", title: "Movies", source: "MOVIES", kind: "MOVIE" },
    {
      key: "auto-documentaries",
      title: "Documentaries",
      source: "DOCUMENTARIES",
      kind: "DOCUMENTARY",
    },
    {
      key: "auto-creator-videos",
      title: "From creators",
      source: "CREATOR_VIDEOS",
      kind: "CREATOR_VIDEO",
    },
    { key: "auto-clips", title: "Short videos", source: "CLIPS", kind: "CLIP" },
  ] as const;
  const kindOf = (candidate: AutomaticHomeCandidate) =>
    candidate.videoForm === "CLIP" ? "CLIP" : candidate.contentType;
  const available = remaining();
  const sections = isKids
    ? []
    : definitions
        .map((definition) => ({
          ...definition,
          candidates: available.filter((candidate) => kindOf(candidate) === definition.kind),
        }))
        .filter((section) => section.candidates.length >= minimumDistinctSectionItems)
        .sort(
          (left, right) =>
            available.indexOf(left.candidates[0]!) - available.indexOf(right.candidates[0]!),
        );

  // A single content type can still offer useful ways to browse. Runtime is
  // real catalogue metadata; never infer genres or popularity from a title.
  const quick = available.filter(
    (item) => item.durationMs !== null && item.durationMs > 0 && item.durationMs < 300_000,
  );
  const longer = available.filter((item) => item.durationMs !== null && item.durationMs >= 300_000);
  const shelves =
    !isKids && sections.length < 2 && quick.length >= 2 && longer.length >= 2
      ? [
          {
            key: "auto-under-five",
            title: "Under five minutes",
            source: "SHORT_WATCHES",
            candidates: quick,
          },
          {
            key: "auto-take-your-time",
            title: "Take your time",
            source: "LONGER_WATCHES",
            candidates: longer,
          },
        ]
      : sections;

  if (shelves.length > 0) {
    for (const section of shelves) {
      if (rows.length >= maximumAutomaticRows) break;
      const selected = selectDiverse(section.candidates, creatorCounts);
      for (const candidate of selected) remember(candidate);
      rows.push(
        finiteRow(
          section.key,
          section.title,
          section.source,
          selected.map((candidate) => ({ ...candidate.item, kicker: section.title })),
        ),
      );
    }
  }

  const rest = remaining();
  const hasContentSection = rows.some((row) => row.source !== "CONTINUE_WATCHING");
  if (
    rows.length < maximumAutomaticRows &&
    rest.length > 0 &&
    (!hasContentSection || rest.length >= minimumDistinctSectionItems)
  ) {
    const selected = selectDiverse(rest, creatorCounts);
    for (const candidate of selected) remember(candidate);
    rows.push(
      finiteRow(
        "auto-discover",
        "Discover AYIN",
        "RECENTLY_ADDED",
        selected.map((candidate) => candidate.item),
      ),
    );
  }

  return {
    mode: "AUTO",
    status: spotlight || rows.length ? "READY" : "EMPTY",
    spotlight,
    rows,
  };
}

function finiteRow(key: string, title: string, source: string, items: DiscoveryItem[]): HomeRow {
  return {
    key,
    title,
    source,
    maxItems: items.length,
    items,
    // This bounded selection has no continuation. Catalogue/search routes own
    // exhaustive browsing; managed rows retain their existing cursor contract.
    nextCursor: null,
    availability: "AVAILABLE",
    emptyMessage: "No eligible videos are available right now.",
  };
}

function selectDiverse(
  candidates: readonly AutomaticHomeCandidate[],
  priorCounts: ReadonlyMap<string, number>,
): AutomaticHomeCandidate[] {
  const counts = new Map(priorCounts);
  const pending = [...candidates];
  const selected: AutomaticHomeCandidate[] = [];
  while (pending.length && selected.length < AUTO_HOME_ROW_LIMIT) {
    // Prefer creators below the cap, preserving recency within that choice.
    // Once every available creator reaches it, relax to the least represented
    // creator. A one-creator catalogue therefore remains fully usable.
    let index = pending.findIndex(
      (candidate) => (counts.get(candidate.creatorId) ?? 0) < preferredItemsPerCreator,
    );
    if (index === -1) {
      const least = Math.min(...pending.map((candidate) => counts.get(candidate.creatorId) ?? 0));
      index = pending.findIndex((candidate) => (counts.get(candidate.creatorId) ?? 0) === least);
    }
    const [candidate] = pending.splice(index, 1);
    if (!candidate) break;
    selected.push(candidate);
    counts.set(candidate.creatorId, (counts.get(candidate.creatorId) ?? 0) + 1);
  }
  return selected;
}
