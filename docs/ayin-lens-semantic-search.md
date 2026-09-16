# AYIN Lens semantic search (Task 67)

AYIN Lens is an optional semantic augmentation to Search V2. It is intentionally designed so AYIN remains fully functional with PostgreSQL lexical search only.

## Release boundary

Semantic retrieval runs only when all three conditions are true:

1. the existing `lensSemanticSearchEnabled` platform feature flag is enabled;
2. `AYIN_LENS_SEMANTIC_KILL_SWITCH` is explicitly disabled (`false`, `0`, `off`, or `no`); and
3. a registered `AyinLensEmbeddingProvider` reports valid approved provider/model/version metadata and is configured.

The kill switch defaults to **on**. The production `SearchModule` registers only `UnconfiguredAyinLensEmbeddingProvider`; Task 67 does not invent credentials, choose an external AI vendor, or fake production semantic results. A future approved provider can replace the injection token without changing the search or policy layers.

If any condition is false, the provider is unavailable, the provider budget is exhausted, the semantic cache has no policy-eligible hits, or a provider call fails, `/public/search/lens` returns the normal Search V2 lexical results.

## What may be embedded

The catalog refresh path reads only public catalog metadata needed to describe a result:

- published, public, playable videos from active channels, after the global video-policy filter;
- published movies with a primary video;
- published series;
- public titles, descriptions/synopses, localized Movie/Series copy, genres, public creator name, tags/category and primary/original language where available.

It does **not** read or transmit watch history, viewer profiles, account IDs, session hashes, IP addresses, recommendation profiles, or other private personalization data.

Task 67 semantically indexes Video, Movie and Series identities. Channel, Playlist and Creator TV remain lexical-only and continue to participate in the final result list through Search V2.

## Eligibility is checked after semantic retrieval

An embedding is never authority to display content. Semantic IDs are hydrated again through AYIN's current product policy path:

- Video must still be `PUBLISHED`, `PUBLIC`, not removed, from an active channel, have a validated playable MP4, and pass `VideoPolicyService` for the request context.
- Movie must resolve through `MovieCatalogService.getPublicBySlug` for the request country.
- Series must resolve through `SeriesCatalogService.getPublicBySlug` for the request country.

This means private/unlisted videos, moderation-removed or blocked videos, geo-ineligible catalog entries, unpublished catalog entries and other unavailable content cannot be returned merely because an old embedding exists.

## PostgreSQL storage and indexing

`CatalogSearchEmbedding` stores:

- entity type/id/slug;
- provider key;
- embedding model and model version;
- dimensions and the cached `double precision[]` vector;
- a SHA-256 hash of the public embedding text;
- source update and embedding timestamps.

The unique key includes entity + provider + model + version. PostgreSQL B-tree indexes narrow reads to the active model/version before a **bounded** in-process cosine scan. Task 67 deliberately does not require `pgvector`, an external search cluster, or a vector SaaS. If corpus scale later makes the bounded scan inadequate, the storage contract can migrate to pgvector/HNSW or another approved implementation without changing provider or policy contracts.

## Refresh and cost controls

Refresh uses content hashes, so unchanged public metadata is not re-embedded. A new provider model/version naturally creates a separate cache identity. Search only warms a completely missing/stale current-model cache; otherwise refresh is expected to be invoked by an approved operational job in bounded batches.

Runtime controls are environment-bounded and have conservative defaults:

- `AYIN_LENS_MAX_PROVIDER_CALLS_PER_MINUTE` (default 30)
- `AYIN_LENS_PROVIDER_BATCH_SIZE` (default 16)
- `AYIN_LENS_MAX_REFRESH_ITEMS` (default 48)
- `AYIN_LENS_REFRESH_STALE_HOURS` (default 168)
- `AYIN_LENS_MAX_VECTOR_SCAN` (default 750)
- `AYIN_LENS_MAX_SEMANTIC_CANDIDATES` (default 48)
- `AYIN_LENS_MIN_SIMILARITY` (default 0.30)
- `AYIN_LENS_MAX_EMBEDDING_TEXT_CHARS` (default 2400)

A process-local one-minute budget prevents unlimited provider calls. Provider batching is capped. Query vectors are not persisted.

## Hybrid ranking

The current deterministic hybrid version is `ayin-lens-hybrid-v1`:

- lexical/product Search V2 rank component: 55%;
- semantic cosine relevance: 35%;
- bounded current Trending product signal for semantic hits: 10%.

The lexical result list is produced first by Search V2, so exact/prefix/language-aware relevance and its existing product popularity blend remain the base behavior. Semantic-only content can enter the list when conceptually relevant, but semantic similarity does not bypass policy eligibility.

## Evaluation before rollout

`lens-evaluation.fixture.ts` is a fixed offline fixture. `lens-evaluation.test.ts` compares lexical and hybrid precision/recall proxies and verifies that a semantic conceptual match can improve the fixture without displacing the exact lexical result. Tests also cover deterministic ordering, feature-flag fallback, kill-switch fallback, unconfigured-provider fallback, provider-failure fallback, vector similarity, storage privacy, and policy/geo exclusion.

Search latency is logged as structured `ayin_lens_search` telemetry containing only mode, semantic-hit count and duration. Query text is intentionally omitted from that latency log.
