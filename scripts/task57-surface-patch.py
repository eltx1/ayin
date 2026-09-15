from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, count))


# Discovery: restrict Kids rows at the source, force Kids context for the public Kids surface,
# and keep Kids links inside the constrained playback contract.
path = "apps/api/src/discovery/discovery.service.ts"
replace(
    path,
    'import { DatabaseService } from "../database/database.service.js";\n',
    'import { DatabaseService } from "../database/database.service.js";\nimport { KIDS_SURFACE_POLICY, isKidsDiscoverySourceAllowed, kidsSafeHref } from "../kids/kids-policy.js";\n',
)
replace(
    path,
    '''    const visibleRows = rows.filter(
      (row) =>
        !row.regionPersonalizationRequired ||
        (normalized.regionPersonalizationAllowed === true && Boolean(normalized.regionCode)),
    );''',
    '''    const visibleRows = rows.filter(
      (row) =>
        (!row.regionPersonalizationRequired ||
          (normalized.regionPersonalizationAllowed === true && Boolean(normalized.regionCode))) &&
        (!normalized.isKidsProfile || isKidsDiscoverySourceAllowed(row.source)),
    );''',
)
replace(
    path,
    '''  async getRow(
    key: string,''',
    '''  async getKidsHome(context: DiscoveryContext = {}) {
    const home = await this.getHome({ ...context, isKidsProfile: true });
    return {
      policy: KIDS_SURFACE_POLICY,
      rows: home.rows.map((row) => ({ ...row, nextCursor: null })),
    };
  }

  async getKidsRow(
    key: string,
    context: DiscoveryContext = {},
    cursor?: string,
    requestedLimit?: number,
  ) {
    return this.getRow(key, { ...context, isKidsProfile: true }, cursor, requestedLimit);
  }

  async getRow(
    key: string,''',
)
replace(
    path,
    '''    if (!context.accountId) {
      return {
        regionCode: normalizeRegionCode(context.regionCode),
        regionPersonalizationAllowed: context.regionPersonalizationAllowed === true,
        availabilityCountryCode: context.availabilityCountryCode,
      };
    }''',
    '''    if (!context.accountId) {
      return {
        regionCode: normalizeRegionCode(context.regionCode),
        regionPersonalizationAllowed: context.regionPersonalizationAllowed === true,
        availabilityCountryCode: context.availabilityCountryCode,
        isKidsProfile: context.isKidsProfile === true,
      };
    }''',
)
replace(
    path,
    '''    return {
      ...page,
      items: page.items.filter((item) => item.type !== "VIDEO" || allowed.has(item.id)),
    };''',
    '''    return {
      ...page,
      items: page.items
        .filter((item) => item.type !== "VIDEO" || allowed.has(item.id))
        .map((item) =>
          context.isKidsProfile && item.type === "VIDEO"
            ? { ...item, href: kidsSafeHref(item.href) }
            : item,
        ),
    };''',
)
replace(
    path,
    '''  ): Promise<DiscoveryPage> {
    switch (row.source) {''',
    '''  ): Promise<DiscoveryPage> {
    if (context.isKidsProfile && !isKidsDiscoverySourceAllowed(row.source)) {
      return emptyPage("This discovery source is disabled in Kids contexts.", "UNAVAILABLE");
    }
    switch (row.source) {''',
)

path = "apps/api/src/discovery/discovery.controller.ts"
replace(
    path,
    '''  @Get("rows/:key")
  async row(''',
    '''  @Get("kids")
  async kids(@Headers() headers: HeaderBag) {
    return runDiscovery(() =>
      this.discovery.getKidsHome({
        availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers),
      }),
    );
  }

  @Get("kids/rows/:key")
  async kidsRow(
    @Param("key") key: string,
    @Query() query: unknown,
    @Headers() headers: HeaderBag,
  ) {
    const parsed = parseListQuery(query);
    return runDiscovery(() =>
      this.discovery.getKidsRow(
        key,
        { availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers) },
        parsed.cursor,
        parsed.limit,
      ),
    );
  }

  @Get("rows/:key")
  async row(''',
)

# Search: Kids search returns only explicitly eligible videos; creator/channel/playlist/TV
# surfaces are deliberately not search sources in the Kids context.
path = "apps/api/src/search/search.service.ts"
replace(
    path,
    'import { DatabaseService } from "../database/database.service.js";\n',
    'import { DatabaseService } from "../database/database.service.js";\nimport { isKidsSearchResultTypeAllowed, kidsSafeHref } from "../kids/kids-policy.js";\n',
)
replace(
    path,
    '          href: `/watch/${video.slug}`,',
    '          href: context.isKidsProfile ? kidsSafeHref(`/watch/${video.slug}`) : `/watch/${video.slug}`,',
    1,
)
replace(
    path,
    '''    const items = ranked.slice(offset, offset + limit);
    return {
      query: normalized,
      items,
      nextCursor: ranked.length > offset + limit ? encodeCursor(offset + limit) : null,''',
    '''    const eligibleRanked = context.isKidsProfile
      ? ranked.filter((item) => isKidsSearchResultTypeAllowed(item.type))
      : ranked;
    const items = eligibleRanked.slice(offset, offset + limit);
    return {
      query: normalized,
      items,
      nextCursor: eligibleRanked.length > offset + limit ? encodeCursor(offset + limit) : null,''',
)
replace(
    path,
    '            href: `/watch/${video.slug}`,',
    '            href: context.isKidsProfile ? kidsSafeHref(`/watch/${video.slug}`) : `/watch/${video.slug}`,',
    1,
)
replace(
    path,
    '''      ].slice(0, limit),
    };''',
    '''      ]
        .filter((item) => !context.isKidsProfile || isKidsSearchResultTypeAllowed(item.type))
        .slice(0, limit),
    };''',
    1,
)

path = "apps/api/src/search/search.controller.ts"
replace(
    path,
    '''  @Get("lens")
  async lens(''',
    '''  @Get("kids")
  async kidsSearch(
    @Req() request: { ip?: string },
    @Query() query: unknown,
    @Headers() headers: HeaderBag,
  ) {
    return runSearch(() => {
      this.rateLimiter.consume(`kids-search:${request.ip ?? "unknown"}`);
      const parsed = searchSchema.safeParse(query);
      if (!parsed.success)
        throw new SearchError("INVALID_SEARCH_QUERY", "The Kids search request is invalid.");
      return this.searchService.search(parsed.data.q, parsed.data.cursor, parsed.data.limit, {
        countryCode: this.trustedRegion.countryFromHeaders(headers),
        isKidsProfile: true,
      });
    });
  }

  @Get("kids/suggestions")
  async kidsSuggestions(
    @Req() request: { ip?: string },
    @Query() query: unknown,
    @Headers() headers: HeaderBag,
  ) {
    return runSearch(() => {
      this.rateLimiter.consume(`kids-suggest:${request.ip ?? "unknown"}`);
      const parsed = suggestSchema.safeParse(query);
      if (!parsed.success)
        throw new SearchError("INVALID_SEARCH_QUERY", "The Kids suggestion request is invalid.");
      return this.searchService.suggest(parsed.data.q, parsed.data.limit, {
        countryCode: this.trustedRegion.countryFromHeaders(headers),
        isKidsProfile: true,
      });
    });
  }

  @Get("lens")
  async lens(''',
)

# Recommendations/autoplay: use the selected profile's Kids bit as a mandatory policy filter.
path = "apps/api/src/recommendations/recommendation.service.ts"
replace(
    path,
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\n',
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\nimport { VideoPolicyService } from "../video-policy/video-policy.service.js";\n',
)
replace(
    path,
    '''    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}''',
    '''    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}''',
)
replace(
    path,
    '''  async getTvSuggestions(profileId: string, context: RecommendationContext = {}) {
    const limit = clamp(context.limit ?? 12, 1, 24);
    const signals = await this.loadSignals(profileId);''',
    '''  async getTvSuggestions(profileId: string, context: RecommendationContext = {}) {
    const limit = clamp(context.limit ?? 12, 1, 24);
    if (await this.isKidsProfile(profileId)) {
      return { profileId, mode: "SAFE_FALLBACK" as const, items: [] };
    }
    const signals = await this.loadSignals(profileId);''',
)
replace(
    path,
    '''    const [personalizationEnabled, weights, signals] = await Promise.all([
      this.settings.get("recommendationsPersonalizedEnabled") as Promise<boolean>,
      this.loadWeights(),
      this.loadSignals(profileId),
    ]);''',
    '''    const [personalizationEnabled, weights, signals, isKidsProfile] = await Promise.all([
      this.settings.get("recommendationsPersonalizedEnabled") as Promise<boolean>,
      this.loadWeights(),
      this.loadSignals(profileId),
      this.isKidsProfile(profileId),
    ]);''',
)
replace(
    path,
    '''    const personalized = personalizationEnabled && this.hasPersonalSignals(signals);
    const items = candidates
      .filter((video) => !signals.excludedVideos.has(video.id))''',
    '''    const allowedCandidateIds = await this.videoPolicy.filterAvailableVideoIds(
      candidates.map((video) => video.id),
      { isKidsProfile },
    );
    const personalized =
      !isKidsProfile && personalizationEnabled && this.hasPersonalSignals(signals);
    const items = candidates
      .filter(
        (video) => allowedCandidateIds.has(video.id) && !signals.excludedVideos.has(video.id),
      )''',
)
replace(
    path,
    '''  private hasPersonalSignals(signals: ProfileSignals) {''',
    '''  private async isKidsProfile(profileId: string) {
    const profile = await this.database.client.viewerProfile.findUnique({
      where: { id: profileId },
      select: { isKids: true },
    });
    return profile?.isKids === true;
  }

  private hasPersonalSignals(signals: ProfileSignals) {''',
)

path = "apps/api/src/recommendations/recommendation.module.ts"
replace(
    path,
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\n',
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\nimport { VideoPolicyModule } from "../video-policy/video-policy.module.js";\n',
)
replace(
    path,
    '  imports: [AuthModule, DatabaseModule, PlatformConfigModule],',
    '  imports: [AuthModule, DatabaseModule, PlatformConfigModule, VideoPolicyModule],',
)

# Playback: a Kids surface request is policy-enforced, disables comments/community hooks,
# carries a non-personalized ad inventory contract and never exposes ordinary related/series autoplay.
path = "apps/api/src/watch/watch.service.ts"
replace(
    path,
    'import { FeatureFlagService } from "../platform-config/feature-flag.service.js";\n',
    'import { FeatureFlagService } from "../platform-config/feature-flag.service.js";\nimport { kidsSafeHref } from "../kids/kids-policy.js";\n',
)
replace(
    path,
    '  async getPublicPlayback(slug: string, countryCode?: string) {',
    '  async getPublicPlayback(slug: string, countryCode?: string, isKidsProfile = false) {',
)
replace(
    path,
    '    const availability = await this.videoPolicy.decide(video.id, { countryCode });',
    '    const availability = await this.videoPolicy.decide(video.id, { countryCode, isKidsProfile });',
)
replace(
    path,
    '''      { countryCode },
    );
    const seriesContext = await this.seriesCatalog.getPublicContextForVideo(video.id, countryCode);''',
    '''      { countryCode, isKidsProfile },
    );
    const seriesContext = isKidsProfile
      ? null
      : await this.seriesCatalog.getPublicContextForVideo(video.id, countryCode);''',
)
replace(
    path,
    '''        commentsSlot: { reserved: true, enabled: video.commentsEnabled },
        externalAdPlacementKeys: ["watch_below_player", "content_detail"],
        policy: {
          maturityLevel: availability.maturityLevel,
          ageRestriction: availability.ageRestriction,
        },
        related: related
          .filter((item) => allowedRelatedIds.has(item.id))
          .map((item) => ({
            id: item.id,
            title: item.title,
            href: `/watch/${item.slug}`,
            durationMs: item.durationMs,
          })),''',
    '''        commentsSlot: { reserved: true, enabled: isKidsProfile ? false : video.commentsEnabled },
        externalAdPlacementKeys: ["watch_below_player", "content_detail"],
        adTargetingPolicy: isKidsProfile
          ? { inventoryClass: "KIDS" as const, personalizedTargetingAllowed: false }
          : { inventoryClass: "GENERAL" as const, personalizedTargetingAllowed: null },
        policy: {
          maturityLevel: availability.maturityLevel,
          ageRestriction: availability.ageRestriction,
          kidsEligible: availability.kidsEligible,
        },
        related: related
          .filter((item) => allowedRelatedIds.has(item.id))
          .map((item) => ({
            id: item.id,
            title: item.title,
            href: isKidsProfile ? kidsSafeHref(`/watch/${item.slug}`) : `/watch/${item.slug}`,
            durationMs: item.durationMs,
          })),''',
)

path = "apps/api/src/watch/watch.controller.ts"
replace(
    path,
    '''  async playback(@Param("slug") slug: string, @Headers() headers: HeaderBag) {
    return runWatchOperation(() =>
      this.watch.getPublicPlayback(slug, this.trustedRegion.countryFromHeaders(headers)),
    );
  }''',
    '''  async playback(
    @Param("slug") slug: string,
    @Query("kids") kids: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    return runWatchOperation(() =>
      this.watch.getPublicPlayback(
        slug,
        this.trustedRegion.countryFromHeaders(headers),
        kids === "1",
      ),
    );
  }''',
)

# Existing recommendation tests get a non-Kids profile and an allow-all policy mock.
path = "apps/api/src/recommendations/recommendation.service.test.ts"
replace(
    path,
    '        recommendationProfileState: { findUnique: vi.fn(async () => null) },',
    '        viewerProfile: { findUnique: vi.fn(async () => ({ isKids: false })) },\n        recommendationProfileState: { findUnique: vi.fn(async () => null) },',
    2,
)
replace(
    path,
    'new RecommendationService(database as never, settings() as never)',
    'new RecommendationService(\n      database as never,\n      settings() as never,\n      { filterAvailableVideoIds: vi.fn(async (ids: string[]) => new Set(ids)) } as never,\n    )',
    2,
)

# Web discovery client gets a dedicated Kids fetch. The Kids page suppresses pagination so a
# normal discovery row endpoint can never be used accidentally from the Kids surface.
path = "apps/web/src/lib/discovery.ts"
replace(path, 'export type DiscoveryItemType = "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST";', 'export type DiscoveryItemType = "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST" | "SERIES";')
replace(
    path,
    '''export interface DiscoveryHomeResponse {
  rows: DiscoveryRowData[];
}''',
    '''export interface DiscoveryHomeResponse {
  rows: DiscoveryRowData[];
  policy?: {
    mode: "KIDS";
    contentEligibility: string;
    advertising: { inventoryClass: "KIDS"; personalizedTargetingAllowed: false };
    socialCommunity: { enabled: false };
    legalReview: { required: true; complianceClaimed: false };
  };
}''',
)
replace(
    path,
    '''export async function fetchDiscoveryRow(''',
    '''export async function fetchKidsDiscoveryHome(signal?: AbortSignal): Promise<DiscoveryHomeResponse> {
  const response = await fetch(`${apiBaseUrl}/public/discovery/kids`, {
    cache: "no-store",
    credentials: "include",
    signal: signal ?? null,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as DiscoveryHomeResponse;
}

export async function fetchDiscoveryRow(''',
)

path = "apps/web/src/components/discovery/discovery-home.tsx"
replace(
    path,
    'import { fetchDiscoveryHome, getIdentity, type DiscoveryHomeResponse } from "@/lib/discovery";',
    'import { fetchDiscoveryHome, fetchKidsDiscoveryHome, getIdentity, type DiscoveryHomeResponse } from "@/lib/discovery";',
)
replace(path, 'export function DiscoveryHome() {', 'export function DiscoveryHome({ kidsMode = false }: { kidsMode?: boolean }) {')
replace(
    path,
    '''        const identity = await getIdentity(controller.signal);
        const signedIn = Boolean(identity);
        if (!controller.signal.aborted) setAuthenticated(signedIn);
        const response = await fetchDiscoveryHome(signedIn, controller.signal);''',
    '''        const identity = kidsMode ? null : await getIdentity(controller.signal);
        const signedIn = Boolean(identity);
        if (!controller.signal.aborted) setAuthenticated(signedIn);
        const response = kidsMode
          ? await fetchKidsDiscoveryHome(controller.signal)
          : await fetchDiscoveryHome(signedIn, controller.signal);''',
)
replace(path, '  }, []);', '  }, [kidsMode]);', 1)

# Admin navigation exposes the classification tool.
path = "apps/web/src/components/admin/admin-sidebar.tsx"
replace(
    path,
    '  { label: "Videos", href: "/admin/videos", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },',
    '  { label: "Videos", href: "/admin/videos", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },\n  { label: "Kids Classification", href: "/admin/kids", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },',
)
