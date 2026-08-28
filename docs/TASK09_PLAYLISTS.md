# Task 09 — Playlist product

## Product boundaries

Task 09 adds the creator playlist product without starting collaborative playlists, social actions or Creator TV scheduling.

- Every channel keeps the protected `UPLOADS` system playlist provisioned during registration.
- Task 07 publish remains the automatic source of Uploads membership and the database unique key `(playlistId, videoId)` guarantees a video cannot appear twice in the same playlist.
- Creator-managed playlists can be created, renamed, described, soft-deleted and assigned `PUBLIC`, `UNLISTED` or `PRIVATE` visibility.
- Creator-managed playlist items can be added, removed and reordered.
- Uploads cannot be deleted and its items cannot be manually removed/reordered because that would violate the automatic-publish invariant.
- Uploads can be renamed by channel owners only when the `allowCreatorUploadsPlaylistRename` platform setting is enabled. Admin actors may override the name through the service boundary.
- Playlist slugs are generated once from the initial name plus a stable random playlist ID suffix and are not rewritten on rename.

## Visibility

`Playlist.visibility` is the canonical V1 visibility field:

- `PUBLIC` — listed on the creator channel and accessible by URL.
- `UNLISTED` — accessible by direct URL but not listed on the public channel.
- `PRIVATE` — creator/admin only.

The earlier `Playlist.isPublic` field is retained temporarily as a compatibility projection for the Task 08 channel query. Task 09 writes both fields together and the migration adds a database check constraint so they cannot disagree. This allows a forward migration without breaking the already-merged public-channel surface.

Public playlist responses also filter playlist items to videos that are both `PUBLISHED` and `PUBLIC`, preventing an otherwise-public playlist from exposing private/unlisted videos.

## Watch Later boundary

Watch Later is intentionally not represented as a creator playlist. `WatchLaterItem` belongs to a `ViewerProfile` and a `Video`, with a unique `(profileId, videoId)` constraint and indexes for My AYIN ordering. Task 09 establishes the durable model only; viewer-facing toggle actions remain Task 14 scope.

## API

Public:

- `GET /public/channels/:handle/playlists/:slug`

Creator owner:

- `GET /creator/channels/:channelId/playlists`
- `POST /creator/channels/:channelId/playlists`
- `GET /creator/playlists/:playlistId`
- `PATCH /creator/playlists/:playlistId`
- `DELETE /creator/playlists/:playlistId`
- `POST /creator/playlists/:playlistId/items`
- `DELETE /creator/playlists/:playlistId/items/:itemId`
- `PUT /creator/playlists/:playlistId/items/reorder`

All creator HTTP routes resolve ownership server-side. The exported `PlaylistService` also accepts an explicit admin actor, verifies `ADMIN`/`SUPERADMIN`, and audit-logs admin mutations so later Admin UI can use the same policy path.

## Web

- `/channel/playlists` — small creator playlist library/create surface.
- `/channel/playlists/:playlistId` — metadata and item editor.
- `/c/:handle/playlists/:slug` — public/unlisted playlist page.
- Public channel playlist cards link to the canonical public playlist page.

## Ordering and duplicate safety

Playlist item order uses an integer `position` protected by `(playlistId, position)` uniqueness. Item mutations take a PostgreSQL transaction-scoped advisory lock per playlist, so append/reorder/remove operations serialize for that playlist. Reorder temporarily shifts positions before assigning the requested gapless `0..n-1` order.
