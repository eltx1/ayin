from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:80]!r}")
    path.write_text(text.replace(old, new, 1))


def insert_before_next(path: Path, marker: str, closing: str, insertion: str) -> None:
    text = path.read_text()
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f"marker not found in {path}: {marker!r}")
    end = text.find(closing, start)
    if end < 0:
        raise SystemExit(f"closing marker not found in {path}: {closing!r}")
    path.write_text(text[:end] + insertion + text[end:])


# Watch: enrich an assigned episode without changing ordinary Video progress/playback.
watch = Path("apps/api/src/watch/watch.service.ts")
replace_once(
    watch,
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\n',
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\nimport { SeriesCatalogService } from "../series-catalog/series-catalog.service.js";\n',
)
replace_once(
    watch,
    '    @Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n',
    '    @Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService,\n    @Inject(SeriesCatalogService) private readonly seriesCatalog: SeriesCatalogService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n',
)
replace_once(
    watch,
    '    const allowedRelatedIds = await this.videoPolicy.filterAvailableVideoIds(\n      related.map((item) => item.id),\n      { countryCode },\n    );\n\n    const adaptiveSource =\n',
    '    const allowedRelatedIds = await this.videoPolicy.filterAvailableVideoIds(\n      related.map((item) => item.id),\n      { countryCode },\n    );\n    const seriesContext = await this.seriesCatalog.getPublicContextForVideo(video.id, countryCode);\n\n    const adaptiveSource =\n',
)
replace_once(
    watch,
    '      detail: {\n        contentType: "CREATOR_VIDEO" as const,\n',
    '      detail: {\n        contentType: seriesContext ? ("SERIES_EPISODE" as const) : ("CREATOR_VIDEO" as const),\n        seriesContext,\n        nextEpisode: seriesContext?.nextEpisode ?? null,\n',
)

# Search: make published Series a first-class result and suggestion.
search = Path("apps/api/src/search/search.service.ts")
replace_once(
    search,
    'import { DatabaseService } from "../database/database.service.js";\n',
    'import { DatabaseService } from "../database/database.service.js";\nimport { SeriesCatalogService } from "../series-catalog/series-catalog.service.js";\n',
)
replace_once(
    search,
    'export type SearchResultType = "VIDEO" | "CHANNEL" | "PLAYLIST" | "CREATOR_TV";\n',
    'export type SearchResultType = "VIDEO" | "CHANNEL" | "PLAYLIST" | "CREATOR_TV" | "SERIES";\n',
)
replace_once(
    search,
    '    @Inject(DatabaseService) private readonly database: DatabaseService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n',
    '    @Inject(DatabaseService) private readonly database: DatabaseService,\n    @Inject(SeriesCatalogService) private readonly seriesCatalog: SeriesCatalogService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n',
)
replace_once(
    search,
    '    const [videos, channels, playlists, televisions] = await Promise.all([\n',
    '    const [videos, channels, playlists, televisions, seriesResults] = await Promise.all([\n',
)
insert_before_next(
    search,
    '    const [videos, channels, playlists, televisions, seriesResults] = await Promise.all([\n',
    '    ]);',
    '      this.seriesCatalog.listPublic(takePerType, normalized, context.countryCode),\n',
)
replace_once(
    search,
    '      ...channels.map((channel) => ({\n',
    '      ...seriesResults.map((series) => ({\n        id: series.id,\n        type: "SERIES" as const,\n        title: series.title,\n        href: `/series/${series.slug}`,\n        kicker: "Series",\n        meta: `${series.episodeCount} episodes`,\n        artworkObjectKey:\n          series.artwork.find((item) => item.type === "POSTER")?.objectKey ??\n          series.artwork.find((item) => item.type === "BACKDROP")?.objectKey ??\n          null,\n      })),\n      ...channels.map((channel) => ({\n',
)
replace_once(
    search,
    '          ? "No matches yet. Try a creator name, video title, playlist, or Creator TV."\n',
    '          ? "No matches yet. Try a series, creator name, video title, playlist, or Creator TV."\n',
)
replace_once(
    search,
    '    const [videos, channels, televisions] = await Promise.all([\n',
    '    const [videos, channels, televisions, seriesSuggestions] = await Promise.all([\n',
)
insert_before_next(
    search,
    '    const [videos, channels, televisions, seriesSuggestions] = await Promise.all([\n',
    '    ]);',
    '      this.seriesCatalog.listPublic(limit, normalized, context.countryCode),\n',
)
text = search.read_text()
suggest_start = text.find('      suggestions: [')
channel_pos = text.find('        ...channels.map((channel) => ({', suggest_start)
if suggest_start < 0 or channel_pos < 0:
    raise SystemExit("search suggestions marker not found")
series_suggestions = '''        ...seriesSuggestions.map((series) => ({
          id: series.id,
          type: "SERIES" as const,
          label: series.title,
          href: `/series/${series.slug}`,
        })),
'''
search.write_text(text[:channel_pos] + series_suggestions + text[channel_pos:])

# Discovery: replace the SERIES placeholder and decorate Continue Watching with episode context.
discovery = Path("apps/api/src/discovery/discovery.service.ts")
replace_once(
    discovery,
    'import { DatabaseService } from "../database/database.service.js";\n',
    'import { DatabaseService } from "../database/database.service.js";\nimport { SeriesCatalogService } from "../series-catalog/series-catalog.service.js";\n',
)
replace_once(
    discovery,
    'export type DiscoveryItemType = "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST";\n',
    'export type DiscoveryItemType = "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST" | "SERIES";\n',
)
replace_once(
    discovery,
    '    @Inject(HomeRowConfigService) private readonly rows: HomeRowConfigService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n',
    '    @Inject(HomeRowConfigService) private readonly rows: HomeRowConfigService,\n    @Inject(SeriesCatalogService) private readonly seriesCatalog: SeriesCatalogService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n',
)
replace_once(
    discovery,
    '      this.loadContinueWatching(profileId, 0, firstPageSize),\n',
    '      this.loadContinueWatching(profileId, 0, firstPageSize, context.availabilityCountryCode),\n',
)
text = discovery.read_text()
text = text.replace(
    'this.loadContinueWatching(context.profileId, offset, limit)',
    'this.loadContinueWatching(\n            context.profileId,\n            offset,\n            limit,\n            context.availabilityCountryCode,\n          )',
)
discovery.write_text(text)
replace_once(
    discovery,
    '      case "SERIES":\n        return emptyPage(\n          "AYIN stores optional creator series/episode placeholders, but no first-class catalog relationship exists yet, so discovery will not promote those placeholders as catalog truth.",\n          "UNAVAILABLE",\n        );\n',
    '      case "SERIES":\n        return this.loadSeries(context, offset, limit);\n',
)
series_loader = '''  private async loadSeries(
    context: DiscoveryContext,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const records = await this.seriesCatalog.listPublic(
      Math.min(offset + limit + 1, 100),
      undefined,
      context.availabilityCountryCode,
    );
    const items: DiscoveryItem[] = records.slice(offset).map((series) => ({
      id: series.id,
      type: "SERIES",
      title: series.title,
      href: `/series/${series.slug}`,
      kicker: "Series",
      meta: `${series.episodeCount} episodes`,
      artworkObjectKey:
        series.artwork.find((item) => item.type === "POSTER")?.objectKey ??
        series.artwork.find((item) => item.type === "BACKDROP")?.objectKey ??
        null,
    }));
    return paged(items, offset, limit, "Published AYIN series will appear here.");
  }

'''
replace_once(
    discovery,
    '  private async loadRecentVideos(\n',
    series_loader + '  private async loadRecentVideos(\n',
)
replace_once(
    discovery,
    '  private async loadContinueWatching(\n    profileId: string,\n    offset: number,\n    limit: number,\n  ): Promise<DiscoveryPage> {\n',
    '  private async loadContinueWatching(\n    profileId: string,\n    offset: number,\n    limit: number,\n    countryCode?: string,\n  ): Promise<DiscoveryPage> {\n',
)
replace_once(
    discovery,
    '    return paged(\n      records.map((record) => ({\n        ...toVideoItem(record.video, "Continue Watching"),\n        progress: {\n          positionMs: record.positionMs,\n          completedAt: record.completedAt?.toISOString() ?? null,\n        },\n      })),\n',
    '    const contexts = await this.seriesCatalog.getPublicContextsForVideos(\n      records.map((record) => record.video.id),\n      countryCode,\n    );\n    return paged(\n      records.map((record) => {\n        const context = contexts.get(record.video.id);\n        return {\n          ...toVideoItem(\n            record.video,\n            context\n              ? `${context.series.title} · S${context.season.seasonNumber} E${context.episode.episodeNumber}`\n              : "Continue Watching",\n          ),\n          ...(context ? { meta: context.episode.title, seriesContext: context } : {}),\n          progress: {\n            positionMs: record.positionMs,\n            completedAt: record.completedAt?.toISOString() ?? null,\n          },\n        };\n      }),\n',
)

# Existing unit harnesses construct these services directly, so provide the new catalog collaborator.
search_test = Path("apps/api/src/search/search.service.test.ts")
text = search_test.read_text()
needle = '    { filterAvailableVideoIds: vi.fn(async (ids: string[]) => new Set(ids)) } as never,\n'
if text.count(needle) != 2:
    raise SystemExit("unexpected SearchService harness shape")
text = text.replace(
    needle,
    '    { listPublic: vi.fn(async () => []) } as never,\n' + needle,
)
search_test.write_text(text)

watch_test = Path("apps/api/src/watch/watch.service.test.ts")
replace_once(
    watch_test,
    '    featureFlags as never,\n    policy as never,\n',
    '    featureFlags as never,\n    { getPublicContextForVideo: vi.fn().mockResolvedValue(null) } as never,\n    policy as never,\n',
)

print("Task 56 integrations patched")
