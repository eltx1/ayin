# AYIN V1 In-Player Video Ads

Task 19 implements a provider-neutral AYIN video-ad decision boundary with Google IMA HTML5 as the first web/PWA playback adapter.

## Safety defaults

Video advertising is disabled by default. AYIN never invents a Google Ad Manager network ID, ad unit, VAST tag, seller ID, or demand source. The public decision endpoint returns a disabled result when the master switch is off, the content is not eligible, a content override disables ads, or no configured VAST source exists.

## Ad sources

Admin can configure an external VAST tag URL. If it is absent, AYIN can expose its local house VAST endpoint only after an AYIN-owned MP4 creative URL has been explicitly configured. Without an owned creative, the house endpoint returns unavailable and content playback falls back without pretending an ad filled.

## Google IMA

The web adapter loads the official IMA HTML5 SDK at runtime and owns `AdDisplayContainer`, `AdsLoader`, `AdsRequest`, and `AdsManager` lifecycle outside the core AYIN Player. The player exposes only the existing provider-neutral ad-mode container. Content is paused/resumed from IMA lifecycle callbacks; ad errors release ad mode and resume content.

The playback activation overlay provides the user interaction needed to initialize the IMA ad display container on environments that require a gesture before media/ad playback. Pre-roll is requested on activation. Mid-roll uses the configured V1 interval and at most one interval-triggered break per content playback. Post-roll is requested when content completes. A session frequency cap is enforced client-side as a V1 guard and the decision contract is ready for stronger server-side controls later.

## Events

AYIN records request/fill/impression/start/quartiles/complete/click/error into the existing `AdEvent` model using system in-player placements. Task 22 may add higher-volume batching/aggregation; Task 19 intentionally avoids creating a competing analytics pipeline.

## Overrides

`VideoAdOverride` supports one channel or one video target per row. Resolution order is global defaults -> channel override -> video override. Stable IDs are used and the database enforces exactly one target.

## External production prerequisite

Real Google Ad Manager production validation remains external. It requires actual GAM network/ad-unit/tag configuration and consent/privacy configuration supplied for AYIN. Task 19 does not claim production fill or GAM account verification. Task 36 is the dedicated production GAM integration task; its repo-side adapters can be completed without credentials, while live account verification remains blocked until real account data is available.
