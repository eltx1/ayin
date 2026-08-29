# Task 13 — Search and unified content detail

## Scope

Task 13 adds V1 PostgreSQL-backed search and a reusable content-detail pattern without starting Task 14 social actions or Task 15 comments.

## Search

Public search supports only entity types that exist durably in the current AYIN schema:

- `VIDEO` — published, public, active-channel videos with an uploaded/validated MP4 source.
- `CHANNEL` — active public creator channels.
- `PLAYLIST` — public, non-deleted playlists owned by active channels.
- `CREATOR_TV` — active, non-disabled Creator TV channels owned by active channels.

Movie and series search results are intentionally not invented because dedicated movie/series catalog entities do not exist yet.

Search behavior:

- Unicode is normalized with NFKC.
- control/format characters are replaced and whitespace is collapsed.
- queries are length-bounded.
- Prisma/PostgreSQL case-insensitive `contains` filters are used; user text is never interpolated into raw SQL.
- unified results receive deterministic V1 relevance scoring and stable tie-breaking.
- pagination uses an opaque, bounded cursor and a maximum page size.
- autocomplete uses the same eligibility boundary and a small result limit.
- public search and suggestion endpoints have separate per-IP, per-minute in-process rate limits.

The in-memory rate limiter is appropriate for the current modular-monolith V1 process. A multi-instance deployment should replace its storage with a shared limiter/store while preserving the controller boundary.

## Public API

- `GET /public/search?q=...&types=VIDEO,CHANNEL,PLAYLIST,CREATOR_TV&cursor=...&limit=...`
- `GET /public/search/suggestions?q=...&limit=...`
- `GET /public/content/videos/:slug`

## Search web experience

`/search` is now a real viewer route rather than a placeholder. It provides:

- debounced autocomplete suggestions.
- All / Videos / Channels / Playlists / Creator TV filters.
- loading skeletons.
- useful initial, error and no-result states.
- bounded Load more pagination.
- TV-focus attributes on interactive controls.

## Unified content detail

The video watch route now obtains one content-detail contract that includes the existing Task 11 playback contract plus:

- title, description, duration and publication date.
- creator identity.
- thumbnail reference when present.
- related eligible public videos.
- a typed Save hook reserved for Task 14.
- a typed comments slot reserved for Task 15.
- inert external placement keys `watch_below_player` and `content_detail` for the later outside-player advertising task.

No save mutation, comments, ad fill or fake advertising UI is implemented in Task 13.

The web `ContentDetailLayout` accepts a content-kind union that is ready for movie, series, season, episode, short, TV channel and future live-event detail models. Only `VIDEO` is emitted today because those other catalog entities do not yet exist.

## Known limitations

- V1 search uses PostgreSQL `contains` queries plus application relevance scoring; it intentionally does not introduce Elasticsearch.
- Search rate-limit counters are process-local until AYIN runs multiple API instances.
- Movie/series search and detail data await durable catalog models/taxonomy rather than masquerading creator videos as studio catalog entities.
- Save, comments and outside-player ads remain reserved hooks for their roadmap tasks.
