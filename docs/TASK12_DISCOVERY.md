# Task 12 — Home Discovery and My AYIN

## Scope

Task 12 replaces placeholder consumer catalog rows with real database-backed discovery and creates the first My AYIN library surface. It does not implement Task 13 search/detail work, Task 14 social actions, or Task 18 Admin Home Builder UI.

## Home row configuration

`HomeRowConfig` is the durable merchandising contract that Task 18 can edit later. Each row has a stable key, display title, source, audience, enabled state, position, maximum item count, and optional region-personalization requirement. `HomeRowManualItem` provides ordered manual merchandising for supported existing entity types.

The page renders the database configuration in position order. Business ordering and row enablement are therefore not embedded in the Home page component.

The seed creates global, country-neutral defaults. It does not seed catalog content.

## V1 row sources

- Continue Watching uses incomplete `WatchProgress` for the selected viewer profile.
- Trending Worldwide ranks recent real `WatchHistory` activity over seven days.
- Popular Now ranks real `WatchHistory` activity over the last 24 hours.
- New on AYIN returns eligible published videos from the recent publication window.
- Because You Watched uses the most recently watched eligible video and recommends other eligible videos from the same creator channel as a simple rule-based V1.
- Creator TV returns active Creator TV channels backed by real channels.
- Creators You Follow reads the existing subscription relation. Its default Home row remains disabled until the consumer subscription actions are exposed by the later social task.
- Recently Added returns the newest eligible published videos.
- Editor Picks resolves ordered manual references in batches and silently omits references that are no longer publicly eligible.

## Honest unavailable sources

Movies and Series are represented as supported row source types but disabled by default because the current schema does not yet contain a movie/series catalog classification. AYIN does not relabel ordinary creator videos to make those rows look populated.

Popular Near You/Region requires both an approved region signal and explicit personalization permission. The current schema does not store region-tagged watch aggregates, so the row returns an honest unavailable state rather than fabricating a regional ranking. No country is hard-coded as a default.

## My AYIN

My AYIN is authenticated and viewer-profile scoped. The supplied profile ID must belong to the signed-in account; otherwise the API rejects access.

Current sections:

- Continue Watching from `WatchProgress`.
- Watch Later from `WatchLaterItem`.
- Watch History from `WatchHistory`.
- Liked Content from existing `Reaction` records of type `LIKE`.
- Playlists from channels the authenticated account belongs to.
- My List is an explicit unavailable hook until the later social-actions task provides its distinct persistent save model/action.

All empty sections use honest empty or unavailable states rather than fake catalog entries.

## Performance

Large rows expose bounded cursor pagination. Initial pages are intentionally small and the web client lazy-loads more items on demand.

Queries select only card fields and batch nested data. Ranking performs one aggregate query plus one batched video query. Manual Editor Picks groups entity IDs by type and resolves each type in a batch, avoiding per-card database queries.

The web surfaces show responsive skeleton cards during initial and incremental loading.

## Privacy and geography

AYIN remains globally neutral. The discovery API accepts a generic region signal only when the caller also marks regional personalization as allowed. Task 12 does not infer, persist, or guess a user country itself.
