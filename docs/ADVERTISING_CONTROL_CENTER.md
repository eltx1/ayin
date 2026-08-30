# AYIN Advertising Control Center

Task 21 centralizes advertising inventory administration and adds a V1 direct campaign manager without fabricating production demand.

## Admin controls

Protected `/admin/advertising` APIs expose logical AdPlacement listing/creation/edit/disable operations, ad event counters, advertiser/campaign/creative management, and the emergency advertising kill switch. Existing in-player defaults and per-channel/video overrides remain under `/admin/video-ads` and are linked from the control center.

All advertiser, campaign, creative, placement, financial metadata, and kill-switch mutations are recorded in `AdminAuditLog`.

## Direct campaign configuration

`DirectCampaignConfig` adds deterministic V1 delivery metadata to the normalized Campaign entity: priority, CPM or fixed pricing metadata, impression goal, frequency cap, pacing mode, and targeting. Targeting supports logical placement keys, ISO country codes, regions, device family, category, channel and individual video IDs.

`DirectCreativeConfig` adds approved asset references or URLs plus display dimensions while the core Creative model remains the canonical status/type/destination/VAST/media-asset record.

Campaigns can be paused or resumed immediately by status mutation. Draft campaigns with no events can be deleted; delivered campaigns retain history. Creatives with delivery history are archived instead of destructively removed.

## Decision service

`GET /ads/direct/decision` uses a deterministic policy. A candidate must be active, within its date window, below its impression goal and session frequency cap, pass targeting, and pass the V1 pacing rule. Highest priority wins; campaign ID provides deterministic tie-breaking. No eligible campaign returns a disabled decision rather than fake fill.

The decision returns only an active creative and its approved repository metadata. Delivery events are recorded through `/ads/direct/events` and attach placement, campaign and creative IDs to `AdEvent`.

## Emergency kill switch

`ADVERTISING/emergencyKillSwitch` is a platform-level emergency state. Direct decisioning checks it before returning demand. All page and video demand adapters must treat this setting as authoritative before production enablement; live provider enforcement is revalidated in Task 36.

## External boundaries

No production Google Ad Manager IDs, R2 object references, advertiser billing facts, or live campaign delivery are invented. Real provider credentials and live-fill verification remain external prerequisites where applicable.
