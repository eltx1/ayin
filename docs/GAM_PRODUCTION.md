# Google Ad Manager production integration

Task 68 hardens AYIN's existing Google Ad Manager (GAM), Google Publisher Tag (GPT), and Interactive Media Ads (IMA) integration without inventing account or inventory identifiers.

## Configuration boundary

AYIN reads only operator-supplied values:

- `GAM_NETWORK_CODE`
- `GAM_PUBLISHER_ID`
- `GAM_VIDEO_AD_UNIT_PATH`
- `GAM_DISPLAY_AD_UNIT_PREFIX`
- `GAM_ADS_TXT_RELATIONSHIP` (`DIRECT` or `RESELLER`)
- `GAM_TEST_MODE` (defaults to `1`)
- `GAM_PRODUCTION_ENABLED` (defaults to `0`)
- `GAM_KILL_SWITCH` (defaults to `0`)

No network code, publisher ID, ad unit, app-ads.txt ID, or sellers.json record is synthesized by AYIN. Production delivery requires complete explicit configuration and test mode must be disabled. The adapter kill switch is independent of the existing audited master advertising emergency kill switch.

## Current Google behavior used by AYIN

Implementation choices were checked against current official Google Ad Manager / GPT / IMA documentation during Task 68.

For web VAST requests AYIN uses Google's secure GAM endpoint and explicitly sends the configured `iu`, a video slot size, `env=vp`, `gdfp_req=1`, `output=xml_vast4`, the correct `vpos`, and a content-specific `description_url`. AYIN does not synthesize a correlator because the IMA SDK manages it. In GAM test mode, generated video requests use `adtest=on`; production requests omit it.

GPT's `slotRenderEnded` event cannot be used to prove no-fill by itself. Google documents that a network request failure can also surface as `isEmpty=true`, so AYIN records `GPT_EMPTY_OR_NETWORK_FAILURE` rather than incorrectly counting it as definite no-fill.

For IMA, AYIN treats documented empty/no-ad VAST responses 1009 (`VAST_EMPTY_RESPONSE`) and 303 (`VAST_NO_ADS_AFTER_WRAPPER`) as detectable no-fill. Other IMA failures are classified as technical errors. Any ad failure resumes content playback.

## Consent and privacy

`apps/web/src/lib/advertising-consent.ts` is a provider-neutral boundary. It is not a CMP and does not fabricate a consent string or claim that user consent exists.

Until a real consent platform or application consent provider is registered, AYIN uses the safe `LIMITED_ADS` default. For that mode GPT loads Google's limited-ads script and configures `limitedAds`; Google IMA GAM URLs receive `ltd=1`. A registered provider can return `NON_PERSONALIZED` (GPT `nonPersonalizedAds`, IMA `npa=1`) or `PERSONALIZED` where policy and consent allow it.

A real CMP remains responsible for collecting and signaling any legally required consent. The provider interface is the integration boundary for that future work.

AYIN does not add session IDs, account IDs, profile IDs, watch history, raw IP data, or similar private viewer data to Google ad targeting. First-party request/session IDs remain inside AYIN advertising telemetry for operational diagnostics and frequency caps.

## Video delivery

`VideoAdService` keeps explicit per-video/channel VAST overrides first. If no explicit tag is configured, it may generate a GAM tag only from the real configured video ad unit and only while both advertising kill switches permit delivery. AYIN-owned house VAST remains the final fallback.

The generated GAM decision provides preroll/midroll/postroll-specific VAST URLs. The player continues to use IMA for ad playback and resumes the underlying content when ads fail. AYIN's core player retains its existing adaptive HLS path and MP4 fallback; Task 68 does not replace or bypass that playback logic.

## Page slots

A GPT placement is eligible only when page ads are enabled, the placement is eligible, the GAM adapter can request ads, and the placement ad unit is equal to or below the explicitly configured `GAM_DISPLAY_AD_UNIT_PREFIX`. A mismatched or unconfigured ad unit never generates a Google request; the placement falls back to an AYIN house creative or collapses according to its existing placement policy.

## Diagnostics

`GET /admin/advertising/gam/diagnostics` reports:

- adapter state: unconfigured, killed, test, production, or disabled;
- network, publisher/seller, video-ad-unit, and display-prefix configuration status;
- master and adapter kill-switch state;
- live-request readiness;
- recent IMA and GPT request/fill/error health over a bounded 60-minute event window;
- detectable IMA no-fill separately from technical errors;
- GPT ambiguous empty/network failures separately from technical loader/runtime failures.

Diagnostics aggregate first-party ad events and do not expose viewer profiles or session identifiers.

## Authorized seller files

Automatic seller rows are generated only when a real configured Google publisher ID and relationship are present. AYIN emits the valid three-field record:

`google.com, <configured publisher id>, <DIRECT or RESELLER>`

The optional certification-authority field is not fabricated. Manually managed `ads.txt` and `app-ads.txt` records remain validated and audited. AYIN does not generate Google's `sellers.json`; Google maintains its own seller transparency file.

## Rollout checklist

Before production enablement:

1. Configure the real GAM network, publisher/seller identity, video ad unit, display prefix, and seller relationship.
2. Verify authorized seller files against the actual GAM account.
3. Keep `GAM_TEST_MODE=1` and `GAM_PRODUCTION_ENABLED=0` during integration testing.
4. Validate desktop web and mobile-browser page slots, IMA preroll, HLS content, MP4 fallback, and house/content fallback on ad failures.
5. Confirm diagnostics show expected requests without persistent technical loader errors.
6. Integrate a real CMP/consent provider where required before enabling personalized advertising.
7. Disable test mode, enable production explicitly, and leave both kill switches operational.
