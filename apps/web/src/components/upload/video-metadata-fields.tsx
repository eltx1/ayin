"use client";

import type {
  QuickVideoMetadata,
  RightsBasis,
  VideoCategory,
  VideoContentType,
} from "@/lib/quick-upload";

export type MetadataDraft = {
  tags: string;
  category: "" | VideoCategory;
  primaryLanguage: string;
  recordingDate: string;
  contentType: "" | VideoContentType;
  rightsBasis: "" | RightsBasis;
  rightsNote: string;
  seriesTitle: string;
  seasonNumber: string;
  episodeNumber: string;
  maturityLevel: "" | "GENERAL" | "TEEN" | "MATURE";
  geoAvailabilityMode: "" | "WORLDWIDE" | "INCLUDE_ONLY" | "EXCLUDE";
  geoCountries: string;
  chapters: string;
  adBreakPreference: "" | "AUTOMATIC" | "DISABLED" | "CUSTOM";
  adBreakOffsets: string;
};

export const EMPTY_METADATA_DRAFT: MetadataDraft = {
  tags: "",
  category: "",
  primaryLanguage: "",
  recordingDate: "",
  contentType: "",
  rightsBasis: "",
  rightsNote: "",
  seriesTitle: "",
  seasonNumber: "",
  episodeNumber: "",
  maturityLevel: "",
  geoAvailabilityMode: "",
  geoCountries: "",
  chapters: "",
  adBreakPreference: "",
  adBreakOffsets: "",
};

export function metadataDraftFromApi(metadata: Record<string, unknown> | null | undefined): MetadataDraft {
  if (!metadata) return { ...EMPTY_METADATA_DRAFT };
  const chapters = Array.isArray(metadata.chapters)
    ? metadata.chapters
        .flatMap((chapter) => {
          if (!chapter || typeof chapter !== "object") return [];
          const title = "title" in chapter && typeof chapter.title === "string" ? chapter.title : "";
          const startSeconds =
            "startSeconds" in chapter && typeof chapter.startSeconds === "number"
              ? chapter.startSeconds
              : null;
          return startSeconds === null ? [] : [`${formatTimestamp(startSeconds)} ${title}`.trim()];
        })
        .join("\n")
    : "";
  return {
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter((value): value is string => typeof value === "string").join(", ") : "",
    category: stringValue(metadata.category) as MetadataDraft["category"],
    primaryLanguage: stringValue(metadata.primaryLanguage),
    recordingDate: stringValue(metadata.recordingDate),
    contentType:
      metadata.contentType === "CREATOR_VIDEO" ? "" : (stringValue(metadata.contentType) as MetadataDraft["contentType"]),
    rightsBasis: stringValue(metadata.rightsBasis) as MetadataDraft["rightsBasis"],
    rightsNote: stringValue(metadata.rightsNote),
    seriesTitle: stringValue(metadata.seriesTitle),
    seasonNumber: numberText(metadata.seasonNumber),
    episodeNumber: numberText(metadata.episodeNumber),
    maturityLevel: stringValue(metadata.maturityLevel) as MetadataDraft["maturityLevel"],
    geoAvailabilityMode: stringValue(metadata.geoAvailabilityMode) as MetadataDraft["geoAvailabilityMode"],
    geoCountries: Array.isArray(metadata.geoCountries)
      ? metadata.geoCountries.filter((value): value is string => typeof value === "string").join(", ")
      : "",
    chapters,
    adBreakPreference: stringValue(metadata.adBreakPreference) as MetadataDraft["adBreakPreference"],
    adBreakOffsets: Array.isArray(metadata.adBreakOffsetsSeconds)
      ? metadata.adBreakOffsetsSeconds.filter((value): value is number => typeof value === "number").join(", ")
      : "",
  };
}

export function buildMetadataPayload(
  draft: MetadataDraft,
  options: { includeEmpty?: boolean; includeRights?: boolean } = {},
): QuickVideoMetadata {
  const includeEmpty = options.includeEmpty === true;
  const includeRights = options.includeRights !== false;
  const result: QuickVideoMetadata = {};
  const tags = splitList(draft.tags);
  if (tags.length || includeEmpty) result.tags = tags;
  if (draft.category) result.category = draft.category;
  else if (includeEmpty) result.category = null;
  if (draft.primaryLanguage.trim()) result.primaryLanguage = draft.primaryLanguage.trim();
  else if (includeEmpty) result.primaryLanguage = null;
  if (draft.recordingDate) result.recordingDate = draft.recordingDate;
  else if (includeEmpty) result.recordingDate = null;
  if (draft.contentType) result.contentType = draft.contentType;
  else if (includeEmpty) result.contentType = "CREATOR_VIDEO";
  if (includeRights) {
    if (draft.rightsBasis) result.rightsBasis = draft.rightsBasis;
    if (draft.rightsNote.trim()) result.rightsNote = draft.rightsNote.trim();
    else if (includeEmpty) result.rightsNote = null;
  }
  if (draft.seriesTitle.trim()) result.seriesTitle = draft.seriesTitle.trim();
  else if (includeEmpty) result.seriesTitle = null;
  result.seasonNumber = optionalInteger(draft.seasonNumber, "Season number", includeEmpty);
  result.episodeNumber = optionalInteger(draft.episodeNumber, "Episode number", includeEmpty);
  if (result.seasonNumber === undefined) delete result.seasonNumber;
  if (result.episodeNumber === undefined) delete result.episodeNumber;
  if (draft.maturityLevel) result.maturityLevel = draft.maturityLevel;
  else if (includeEmpty) result.maturityLevel = null;
  if (draft.geoAvailabilityMode) result.geoAvailabilityMode = draft.geoAvailabilityMode;
  else if (includeEmpty) result.geoAvailabilityMode = null;
  const countries = splitList(draft.geoCountries).map((value) => value.toUpperCase());
  if (countries.length || includeEmpty) result.geoCountries = countries;
  if (draft.chapters.trim()) result.chapters = parseChapterLines(draft.chapters);
  else if (includeEmpty) result.chapters = [];
  if (draft.adBreakPreference) result.adBreakPreference = draft.adBreakPreference;
  else if (includeEmpty) result.adBreakPreference = null;
  if (draft.adBreakOffsets.trim()) result.adBreakOffsetsSeconds = parseOffsets(draft.adBreakOffsets);
  else if (includeEmpty) result.adBreakOffsetsSeconds = [];
  return result;
}

export function VideoMetadataFields({
  value,
  onChange,
  fullWidthClassName,
  disabled = false,
  showRights = true,
}: {
  value: MetadataDraft;
  onChange: (next: MetadataDraft) => void;
  fullWidthClassName?: string;
  disabled?: boolean;
  showRights?: boolean;
}) {
  const set = <K extends keyof MetadataDraft>(key: K, next: MetadataDraft[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <>
      <label className={fullWidthClassName}>
        <span>Tags</span>
        <input
          disabled={disabled}
          maxLength={820}
          value={value.tags}
          placeholder="documentary, cairo, architecture"
          onChange={(event) => set("tags", event.target.value)}
        />
        <small>Up to 20 tags, 40 characters each. Separate tags with commas.</small>
      </label>

      <label>
        <span>Category</span>
        <select
          disabled={disabled}
          value={value.category}
          onChange={(event) => set("category", event.target.value as MetadataDraft["category"])}
        >
          <option value="">Not set</option>
          <option value="ENTERTAINMENT">Entertainment</option>
          <option value="EDUCATION">Education</option>
          <option value="GAMING">Gaming</option>
          <option value="MUSIC">Music</option>
          <option value="NEWS">News</option>
          <option value="SPORTS">Sports</option>
          <option value="TECHNOLOGY">Technology</option>
          <option value="LIFESTYLE">Lifestyle</option>
          <option value="FILM_ANIMATION">Film & animation</option>
          <option value="OTHER">Other</option>
        </select>
      </label>

      <label>
        <span>Primary language</span>
        <input
          disabled={disabled}
          maxLength={35}
          value={value.primaryLanguage}
          placeholder="en or ar-EG"
          onChange={(event) => set("primaryLanguage", event.target.value)}
        />
      </label>

      <label>
        <span>Recording date</span>
        <input
          disabled={disabled}
          type="date"
          value={value.recordingDate}
          onChange={(event) => set("recordingDate", event.target.value)}
        />
      </label>

      <label>
        <span>Content type</span>
        <select
          disabled={disabled}
          value={value.contentType}
          onChange={(event) => set("contentType", event.target.value as MetadataDraft["contentType"])}
        >
          <option value="">Creator video (default)</option>
          <option value="MOVIE">Movie</option>
          <option value="DOCUMENTARY">Documentary</option>
        </select>
      </label>

      {showRights ? (
        <>
          <label>
            <span>Rights basis</span>
            <select
              disabled={disabled}
              value={value.rightsBasis}
              onChange={(event) => set("rightsBasis", event.target.value as MetadataDraft["rightsBasis"])}
            >
              <option value="">Standard authorization</option>
              <option value="OWNED">I own it</option>
              <option value="LICENSED">Licensed</option>
              <option value="AUTHORIZED">Authorized</option>
              <option value="PUBLIC_DOMAIN">Public domain</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            <span>Rights note</span>
            <input
              disabled={disabled}
              maxLength={1000}
              value={value.rightsNote}
              placeholder="Optional license or rights note"
              onChange={(event) => set("rightsNote", event.target.value)}
            />
          </label>
        </>
      ) : null}

      <label className={fullWidthClassName}>
        <span>Series / episode placeholder</span>
        <input
          disabled={disabled}
          maxLength={120}
          value={value.seriesTitle}
          placeholder="Series title — optional until AYIN Catalog is available"
          onChange={(event) => set("seriesTitle", event.target.value)}
        />
      </label>

      <label>
        <span>Season number</span>
        <input
          disabled={disabled}
          min={1}
          step={1}
          type="number"
          value={value.seasonNumber}
          onChange={(event) => set("seasonNumber", event.target.value)}
        />
      </label>

      <label>
        <span>Episode number</span>
        <input
          disabled={disabled}
          min={1}
          step={1}
          type="number"
          value={value.episodeNumber}
          onChange={(event) => set("episodeNumber", event.target.value)}
        />
      </label>

      <label>
        <span>Maturity level</span>
        <select
          disabled={disabled}
          value={value.maturityLevel}
          onChange={(event) => set("maturityLevel", event.target.value as MetadataDraft["maturityLevel"])}
        >
          <option value="">Not set</option>
          <option value="GENERAL">General</option>
          <option value="TEEN">Teen</option>
          <option value="MATURE">Mature</option>
        </select>
      </label>

      <label>
        <span>Geographic availability</span>
        <select
          disabled={disabled}
          value={value.geoAvailabilityMode}
          onChange={(event) =>
            set("geoAvailabilityMode", event.target.value as MetadataDraft["geoAvailabilityMode"])
          }
        >
          <option value="">Not set / platform default</option>
          <option value="WORLDWIDE">Worldwide</option>
          <option value="INCLUDE_ONLY">Only selected countries</option>
          <option value="EXCLUDE">Everywhere except selected countries</option>
        </select>
      </label>

      <label className={fullWidthClassName}>
        <span>Country codes</span>
        <input
          disabled={disabled || value.geoAvailabilityMode === "WORLDWIDE"}
          value={value.geoCountries}
          placeholder="EG, US, GB"
          onChange={(event) => set("geoCountries", event.target.value)}
        />
        <small>This is a catalog policy hook; enforcement remains owned by AYIN availability policy.</small>
      </label>

      <label className={fullWidthClassName}>
        <span>Custom chapters</span>
        <textarea
          disabled={disabled}
          rows={5}
          value={value.chapters}
          placeholder={"00:00 Introduction\n02:15 Main topic\n08:40 Final notes"}
          onChange={(event) => set("chapters", event.target.value)}
        />
        <small>One chapter per line: MM:SS Title or HH:MM:SS Title. Starts must increase.</small>
      </label>

      <label>
        <span>Ad-break preference</span>
        <select
          disabled={disabled}
          value={value.adBreakPreference}
          onChange={(event) =>
            set("adBreakPreference", event.target.value as MetadataDraft["adBreakPreference"])
          }
        >
          <option value="">Platform default</option>
          <option value="AUTOMATIC">Automatic</option>
          <option value="DISABLED">No creator-requested breaks</option>
          <option value="CUSTOM">Custom preferred offsets</option>
        </select>
      </label>

      <label>
        <span>Custom ad-break offsets</span>
        <input
          disabled={disabled || value.adBreakPreference !== "CUSTOM"}
          value={value.adBreakOffsets}
          placeholder="120, 480, 900"
          onChange={(event) => set("adBreakOffsets", event.target.value)}
        />
        <small>Seconds from the start; the ad system remains authoritative.</small>
      </label>
    </>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalInteger(value: string, label: string, includeEmpty: boolean): number | null | undefined {
  if (!value.trim()) return includeEmpty ? null : undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive whole number.`);
  return parsed;
}

function parseOffsets(value: string): number[] {
  const offsets = splitList(value).map((part) => Number(part));
  if (offsets.some((offset) => !Number.isSafeInteger(offset) || offset < 1)) {
    throw new Error("Custom ad-break offsets must be positive whole seconds separated by commas.");
  }
  return offsets;
}

function parseChapterLines(value: string): Array<{ title: string; startSeconds: number }> {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = /^(\d{1,2}:)?\d{1,2}:\d{2}\s+(.+)$/.exec(line);
      if (!match) throw new Error(`Chapter line ${index + 1} must use MM:SS Title or HH:MM:SS Title.`);
      const firstSpace = line.indexOf(" ");
      const timestamp = line.slice(0, firstSpace);
      const title = line.slice(firstSpace + 1).trim();
      const parts = timestamp.split(":").map(Number);
      if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
        throw new Error(`Chapter line ${index + 1} has an invalid time.`);
      }
      const seconds =
        parts.length === 3
          ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
          : parts[0]! * 60 + parts[1]!;
      if ((parts.at(-1) ?? 60) >= 60 || (parts.length === 3 && parts[1]! >= 60)) {
        throw new Error(`Chapter line ${index + 1} has an invalid time.`);
      }
      return { title, startSeconds: seconds };
    });
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
