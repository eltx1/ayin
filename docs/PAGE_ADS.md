# AYIN Outside-Player Advertising

Task 20 keeps page inventory separate from in-player video advertising.

## Logical placements

Outside-player inventory is represented by `AdPlacement` records with `inventoryFamily=OUTSIDE_PLAYER`. The initial disabled records are:

- `home_top`
- `home_between_rows`
- `watch_below_player`
- `content_detail`
- `search_between_results`
- `channel_between_rows`
- `tv_directory`
- `desktop_sidebar`

Each placement stores validated JSON configuration for route patterns, responsive sizes, device eligibility, signed-in/signed-out audience, optional content categories, primary demand source and fallback behavior. The records are disabled by default and contain no production ad-unit identifiers.

## Decision flow

`GET /ads/page/decision/:key` resolves the platform page-ad settings and the requested placement against server-derived authentication state plus route/device/category context. A disabled, invalid or ineligible placement returns a disabled decision and the web component collapses cleanly.

Global `ADVERTISING/pageAdsV1` settings default to both page ads and Google GPT disabled. House/direct fallback requires an explicitly configured owned image URL; no synthetic fill is reported.

## Google Publisher Tag adapter

The web/PWA adapter loads the official GPT library only when an eligible Google placement becomes visible near the viewport. It defines a logical slot, applies responsive size mapping, configures empty-slot collapse, enables GPT services once and displays the slot only after its container exists in the DOM. Empty GPT renders collapse or switch to the configured AYIN house fallback.

No Google network code, ad-unit path or seller identifier is committed. Production Google Ad Manager configuration and live-fill verification remain external work for Task 36.

## UX rules

Page ads are isolated from player controls, have an explicit Advertisement label, are not overlaid on interactive content and are lazy requested near the viewport. Empty placements collapse rather than leaving large blank blocks. House clicks open separately and use sponsored link semantics.

## ads.txt and app-ads.txt

Use `docs/ads.txt.template` and `docs/app-ads.txt.template` only after real authorized seller records are known. Never publish guessed publisher IDs, relationship values or certification authority IDs.

## Telemetry

Page inventory records REQUEST, FILL, IMPRESSION, CLICK and ERROR events through the existing `AdEvent` model. This telemetry is best-effort and never blocks content rendering.
