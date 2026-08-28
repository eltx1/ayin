# Task 08 — Public creator channels

Task 08 adds the first public creator-channel surface and a deliberately small creator edit flow.

## Public URLs

Canonical channel URLs use the stable route shape:

```text
/c/{handle}
```

Handles remain mutable presentation identifiers. Relationships continue to use the stable Channel UUID.

When a creator changes a handle, AYIN stores the previous handle in `ChannelHandleRedirect`. Public lookup resolves that record to the stable Channel UUID and the web application permanently redirects to the current canonical handle. A handle reserved by another channel's redirect cannot be claimed.

## Public channel boundary

`GET /public/channels/:handle` exposes only active channel information and:

- published + public videos
- public playlists
- the primary Creator TV entry
- current avatar/banner R2 object references and accent color
- channel Shorts/Posts feature-flag state
- an explicit subscription capability boundary

Task 08 does not expose subscriber counts. Although the Subscription database model already exists, there is no subscription application module/API yet, so the public response reports subscriptions as unavailable and the UI renders a non-functional placeholder intentionally.

## Channel editing

Authenticated owners can use:

- `GET /creator/channels/:channelId`
- `PATCH /creator/channels/:channelId`
- `POST /creator/channels/:channelId/assets/authorize`
- `POST /creator/channels/:channelId/assets/complete`

The editor is intentionally limited to channel name, handle, description, avatar, banner and accent color plus a small read-only summary of publishing defaults.

Channel artwork is uploaded directly from the browser to Cloudflare R2 using short-lived authorization. The API never proxies image bytes and object keys use server-generated asset IDs rather than filenames.

## Admin override boundary

`ChannelService` accepts explicit `owner` or `admin` actors. Owner access is checked against `ChannelMember`; admin access is independently checked against AYIN admin role assignments. The service is exported from `CreatorModule`, allowing a later Admin channel controller to reuse the same mutation logic rather than bypassing it.

## Web configuration

Set:

```text
NEXT_PUBLIC_MEDIA_BASE_URL=https://media.ayin.stream
```

If the media base URL is absent, channel pages render branded image placeholders instead of inventing a media URL.
