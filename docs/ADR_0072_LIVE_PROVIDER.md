# ADR 0072 — AYIN live ingest/transcoding/playback provider

- **Status:** Accepted for implementation planning; production connection remains unverified and disabled.
- **Decision date:** 2026-09-19
- **Task:** AYIN Task 72
- **Selected provider:** Mux Video
- **Fallback provider:** Amazon Interactive Video Service (Amazon IVS Low-Latency Streaming)
- **Production connected:** No
- **Live control-plane proof:** Blocked because no Mux API credentials are available to this task/repository environment.
- **Production behavior changed by Task 72:** No

## Context

AYIN already has a provider-neutral `LiveIngestProvider` boundary and an intentionally
`UnconfiguredLiveIngestProvider`. R2 remains the VOD source/storage path and is not treated as a
live ingest, transcoding, packaging, or live-origin service.

Task 72 is a vendor/architecture decision, not the production implementation. The current
`LiveIngestProvider` contract assumes AYIN creates a stream key and supplies it to the provider.
That assumption does not fit the managed-provider control planes reviewed here: Mux, Amazon IVS,
and Cloudflare Stream generate provider-side broadcast credentials. Task 73 therefore needs a
small provider-contract revision so a provider can return one-time broadcast credentials while
AYIN stores only a hash.

Research below uses current official documentation reviewed on 2026-09-19. Scores are an AYIN
architecture assessment, not vendor claims.

## Decision criteria and weights

| Criterion                                  |  Weight |
| ------------------------------------------ | ------: |
| RTMPS/SRT ingest + OBS fit                 |      12 |
| Playback latency                           |      12 |
| Autoscaling + global CDN                   |      10 |
| Recording, webhook lifecycle, key rotation |      12 |
| API maturity + operability                 |      10 |
| Advertising + Google IMA/DAI path          |      12 |
| DRM/content-security roadmap               |       8 |
| Analytics/observability                    |       7 |
| Cost model + minimum commitments           |       8 |
| VOD handoff + vendor portability           |       9 |
| **Total**                                  | **100** |

Each candidate is scored from 0 to 5. Weighted total is
`sum(weight × score / 5)`.

## Weighted decision matrix

| Candidate             | Ingest | Latency | Scale/CDN | Lifecycle | API | Ads | DRM | Analytics | Cost | Portability | Weighted |
| --------------------- | -----: | ------: | --------: | --------: | --: | --: | --: | --------: | ---: | ----------: | -------: |
| **Mux Video**         |    5.0 |     4.5 |       5.0 |       5.0 | 5.0 | 4.0 | 5.0 |       5.0 |  4.5 |         4.0 | **93.8** |
| Amazon IVS            |    5.0 |     5.0 |       5.0 |       4.5 | 4.5 | 4.5 | 1.0 |       4.5 |  3.0 |         2.5 | **81.8** |
| Bitmovin Live Encoder |    5.0 |     4.0 |       3.0 |       3.5 | 5.0 | 5.0 | 5.0 |       5.0 |  1.5 |         3.5 | **81.7** |
| Cloudflare Stream     |    5.0 |     3.5 |       5.0 |       4.5 | 4.0 | 2.5 | 2.0 |       4.0 |  5.0 |         4.0 | **79.2** |

The result is deliberately not a cheapest-price ranking. Cloudflare has the simplest low list-price
model but does not win because AYIN's roadmap also values ad architecture, DRM, analytics,
lifecycle maturity, and playback resilience.

## Capability review

### Mux Video — selected

**Ingest and OBS.** Mux supports RTMP/RTMPS and SRT. It documents a global auto-select endpoint,
regional ingest endpoints, and explicit OBS configuration. SRT is attractive for unstable creator
uplinks; RTMPS remains the broad compatibility fallback.

**Playback and latency.** Playback is standard HLS and works in Mux Player or third-party HLS
players. Mux documents standard latency around 25–30 seconds, reduced around 12–20 seconds, and
low-latency LL-HLS as low as about 5 seconds. Mux also warns that low-latency modes require stable
encoder hardware/network conditions. AYIN should therefore treat low latency as a configurable
operating mode, not a universal guarantee.

**Scale and CDN.** Mux delivery uses multiple CDNs and can expose redundant renditions so capable
players can fail over between CDNs. This is a better fit for AYIN than binding the player to a
single proprietary playback SDK.

**Recording and VOD handoff.** A live stream automatically creates a recorded Mux asset. For AYIN,
that asset should be a temporary post-live handoff source rather than silently replacing R2 as the
long-term VOD source of truth. Task 73 must specify the export/copy-to-R2 lifecycle, success
verification, and Mux asset-retention policy.

**Lifecycle and key rotation.** Mux exposes live-stream lifecycle webhooks, including connected,
recording, active, disconnected, idle, updated, disabled and deleted events. It also exposes a
reset-stream-key endpoint. Webhook endpoints have a signing secret and signatures must be verified
before lifecycle state is trusted.

**Stream duration.** The current API documents a 43,200-second (12-hour) continuous live-stream
maximum/default. AYIN must surface this operational limit and separately negotiate/test longer
events if required.

**DRM and playback security.** Mux DRM is generally available and covers Widevine, PlayReady, and
FairPlay. Signed playback is also available. DRM should remain an explicit later feature flag; Task
73 must not enable it silently.

**Analytics.** Mux Data is included with Mux-hosted delivery and provides QoE/engagement metrics.
This complements, rather than replaces, AYIN's first-party analytics.

**Advertising.** Mux has an official Google IMA client-side integration guide. This aligns directly
with AYIN's existing `IMA_CLIENT_BREAK` path. Mux documentation reviewed for Task 72 does **not**
establish a direct Google Ad Manager DAI production integration. Therefore Google DAI remains
**unverified**, not selected as part of Task 72.

**Pricing and commitments.** Mux offers pay-as-you-go live service with a monthly usage credit and
100,000 free delivery minutes per month on current pricing. Plus-quality live input for the first
5,000 minutes is currently listed at $0.025/min up to 720p and $0.03125/min at 1080p. Plus 1080p
delivery is listed at $0.001/min after the free delivery allowance, and 1080p storage at
$0.003/min/month. Pre-pay and enterprise discounts are optional rather than required for PAYG.

**Test access.** Mux supports `test: true` live streams without live-stream usage charges. Test
streams are watermarked, limited to five active minutes, and the recorded test asset is deleted
after 24 hours. An account and API token are still required.

### Amazon IVS — fallback

Amazon IVS is the strongest fallback because it has RTMPS and SRT ingest, sub-five-second
low-latency channels, managed global delivery, EventBridge lifecycle events, auto-record-to-S3,
CloudWatch telemetry, mature APIs, and native SSAI integration with AWS Elemental MediaTailor.

Its main AYIN disadvantages are material:

- AWS states IVS does not support stream content encryption/DRM.
- Guaranteed low-latency behavior is more coupled to the IVS playback ecosystem.
- A channel has one stream key; reset is a delete/create-key workflow.
- recording, delivery, MediaTailor, S3 and CloudFront can spread the operational/cost model across
  several AWS services.
- its native SSAI path is MediaTailor, not direct proof of Google Ad Manager DAI compatibility.

If Mux fails procurement, reliability testing, regional ingest tests, or Task 73's real encoder
proof, IVS is the first fallback to implement.

### Cloudflare Stream

Cloudflare Stream has excellent simplicity: RTMPS/SRT ingest, HLS/DASH playback, automatic encoding,
Cloudflare's global network, live webhooks, API key rotation, server-side analytics, signed playback,
and a very simple storage/delivery-minute price model. As of this decision, its low-latency HLS path
comes with compatibility tradeoffs and Stream Live WebRTC is not yet the established production
path AYIN is selecting. The reviewed official Stream documentation also does not establish the
multi-DRM and ad-insertion roadmap AYIN needs. It remains the strongest cost/simplicity alternative.

### Bitmovin Live Encoder

Bitmovin has the deepest broadcast-oriented feature set reviewed: RTMP/SRT main and backup inputs,
HLS/DASH output, live-to-VOD, multi-DRM, SCTE-35, CSAI/SSAI support, major-cloud deployment options,
and mature APIs/observability. It is a strong future option for premium/broadcast workloads.

It does not rank as AYIN's primary managed live platform today because the architecture is more
encoder/deployment oriented than the turnkey ingest-to-global-delivery model AYIN needs first, and
advanced live configurations use a more complex billable-minute/commercial model. PAYG exists and
the public pricing page currently includes free live encoding minutes, so this is not a claim that
Bitmovin always requires an enterprise minimum.

## Google advertising decision

### Google IMA

**Compatible and selected for the initial ad path.** AYIN already owns a client-side IMA boundary,
and Mux provides standard HLS playback plus official documentation for Google IMA client-side ad
insertion. Task 73 should preserve `IMA_CLIENT_BREAK` and avoid coupling AYIN to Mux Player.

### Google Ad Manager DAI

**Not yet verified.** Google documents that its live DAI workflow has specific HLS/DASH integration
requirements and supports SCTE-35/cue signaling. Task 72 found no official Mux documentation that
proves AYIN's intended Mux live output can be connected to Google DAI with the exact conditioning,
cue insertion, and contractual requirements AYIN needs.

Task 73 must therefore keep DAI disabled. A later DAI proof must validate:

1. AYIN's actual Google Ad Manager 360/DAI entitlement and account setup.
2. acceptable HLS/DASH manifest format against Google's current requirements;
3. cue/SCTE-35 generation or manifest manipulation for live mid-rolls;
4. end-to-end ad tracking on web/mobile/TV targets;
5. fallback to unmodified live content when DAI is unavailable.

No Task 72 score treats Google DAI as already working.

## Estimated operational model

Initial implementation target:

1. AYIN creates one Mux Live Stream resource per AYIN `LiveStream` session.
2. Mux returns the provider stream ID, playback ID, stream key and SRT passphrase where applicable.
3. AYIN returns broadcast credentials once to the creator and stores only hashes/metadata required
   for lifecycle control. Raw stream keys/passphrases are not logged.
4. OBS uses SRT when creator/network/device support is validated; RTMPS is the compatibility
   fallback.
5. Start with `latency_mode=low` only for controlled validation. AYIN can fall back to reduced or
   standard latency when network/device testing shows instability.
6. AYIN plays the provider's HLS/LL-HLS URL through the existing AYIN player.
7. Signed Mux webhooks drive provider lifecycle synchronization.
8. Mux's automatic recording becomes the post-live handoff asset; Task 73 defines an explicit,
   verified handoff to AYIN/R2 and deletion/retention rules.
9. AYIN continues to own IMA client-side ads. DAI and DRM remain separate explicit rollouts.
10. Provider enablement is guarded by credentials, an explicit production-enable flag, diagnostics,
    and a rollback to the unconfigured adapter.

### Illustrative public-list-rate model

For one 60-minute **1080p Plus** event at public first-tier rates:

- input: 60 × $0.03125 ≈ **$1.875**
- one month of 1080p recording storage: 60 × $0.003 ≈ **$0.18**
- 100 average viewers watching the full hour: 6,000 delivery minutes × $0.001 ≈ **$6.00**
- illustrative total before free-delivery allowance, taxes, optional features and discounts:
  **about $8.055**

Current Mux pricing includes 100,000 free delivery minutes each month, so actual marginal delivery
for an early-stage workload can be lower. This example is capacity planning, not an account quote or
billing guarantee.

## Proof result

Mux offers free test live streams, but Task 72 has no Mux API token available in the repository/task
environment. Therefore **no real provider API call or production stream is claimed**.

Task 72 adds an opt-in control-plane proof harness. It is deliberately network-inert unless all three
are present:

- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`
- `MUX_TASK72_PROOF=1`

When explicitly enabled, it creates a Mux **test** live stream, verifies a playback ID, resets the
stream key, verifies that the key changed, then deletes the proof resource. It never returns or logs
the raw stream key. Unit tests execute this flow against a mocked provider response.

Run it with:

`pnpm --filter @ayin/api run proof:live-provider`

A successful control-plane proof is still not production verification. Task 73 must run a real
OBS/FFmpeg ingest and player test before production enablement.

## Required Task 73 credentials and secrets

Required for the selected provider:

- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`
- `MUX_WEBHOOK_SIGNING_SECRET` (name to be standardized by AYIN; secret value comes from Mux)
- explicit AYIN production enable/kill-switch configuration, proposed
  `MUX_LIVE_PRODUCTION_ENABLED=1`

Later signed playback/DRM work will also require the appropriate Mux signing key ID/private key.
Those credentials are not required merely to implement basic live streaming and must not be
invented.

## Task 73 implementation contract

Task 73 should implement the selected provider without changing this decision silently.

### Provider contract revision

The provider must own provider-issued broadcast secrets. The conceptual contract is:

```ts
interface LiveProviderCapabilities {
  ingestProtocols: Array<"RTMPS" | "SRT">;
  playbackProtocols: Array<"HLS" | "LL_HLS">;
  supportsKeyRotation: boolean;
  supportsRecording: boolean;
  webhookVerification: "SIGNED";
}

interface LiveProviderProvisionResult {
  providerKey: "mux";
  providerStreamId: string;
  ingest: {
    rtmpsUrl: string;
    srtUrl?: string;
    streamKey: string;
    srtPassphrase?: string;
  };
  playbackId: string;
  playbackUrl: string;
}
```

Raw `streamKey` and `srtPassphrase` are one-time response secrets and must never be persisted or
logged. AYIN may store a non-reversible hash for key-change/audit semantics.

Required provider operations:

- `capabilities()`
- `provision()` — no caller-supplied stream key
- `rotateKey(providerStreamId)` — returns replacement secret once
- `retrieveStatus(providerStreamId)`
- `disable/end(providerStreamId)`
- signed webhook verification and normalized lifecycle-event processing
- recording asset lookup/handoff metadata

### Production gates

Task 73 cannot enable production until all are true:

- real Mux credentials exist and least-privilege token permissions are documented;
- explicit production enable flag is set;
- webhook signature verification is implemented before webhook state changes are trusted;
- stream keys/passphrases are absent from logs and persistence;
- creator sees broadcast credentials only at provisioning/rotation;
- key rotation, reconnect behavior, disable/end and cleanup have real API tests;
- a real 5-minute OBS or FFmpeg test validates SRT and/or RTMPS contribution;
- HLS playback is tested on AYIN web/mobile targets with existing player fallback;
- client-side Google IMA is tested against the real live playback;
- DAI remains disabled until its separate Google-specific proof succeeds;
- the live-recording-to-R2/VOD handoff and retention policy is explicit and verified;
- operational diagnostics and an emergency kill/rollback path exist;
- the default `UnconfiguredLiveIngestProvider` remains the safe fallback.

## Consequences and vendor-lock-in controls

Mux becomes the selected control plane, but AYIN should limit lock-in by:

- continuing to consume standard HLS in AYIN's player instead of requiring Mux Player;
- exposing RTMPS/SRT concepts through an AYIN provider-neutral contract;
- keeping provider lifecycle IDs separate from AYIN stream IDs;
- maintaining R2/AYIN as the intended long-term VOD source of truth;
- keeping client-side IMA outside the live provider adapter;
- mapping provider webhooks to AYIN-owned lifecycle events instead of leaking provider event names
  across the application;
- preserving Amazon IVS as the documented fallback.

## Official sources reviewed

Mux:

- https://www.mux.com/docs/guides/configure-broadcast-software
- https://www.mux.com/docs/guides/reduce-live-stream-latency
- https://www.mux.com/docs/guides/start-live-streaming
- https://www.mux.com/docs/api-reference/video/live-streams/create-live-stream
- https://www.mux.com/docs/api-reference/video/live-streams/reset-stream-key
- https://www.mux.com/docs/core/listen-for-webhooks
- https://www.mux.com/docs/core/manage-webhooks
- https://www.mux.com/docs/guides/play-your-videos
- https://www.mux.com/docs/guides/player-ads
- https://www.mux.com/docs/changelog/drm-general-availability
- https://www.mux.com/docs/pricing/overview
- https://www.mux.com/pricing

Amazon IVS:

- https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html
- https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html
- https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html
- https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_CreateStreamKey.html
- https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/server-side-ad-insertion.html
- https://aws.amazon.com/ivs/pricing/
- https://aws.amazon.com/ivs/faqs/

Cloudflare Stream:

- https://developers.cloudflare.com/stream/stream-live/
- https://developers.cloudflare.com/stream/stream-live/start-stream-live/
- https://developers.cloudflare.com/stream/stream-live/webhooks/
- https://developers.cloudflare.com/stream/pricing/
- https://developers.cloudflare.com/stream/getting-analytics/
- https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/

Bitmovin:

- https://bitmovin.com/live-encoding-live-streaming
- https://bitmovin.com/live-encoding-live-streaming/live-monetization
- https://bitmovin.com/pricing/
- https://legal.bitmovin.com/legal/emcm

Google Ad Manager DAI:

- https://support.google.com/admanager/answer/13049537
- https://support.google.com/admanager/answer/13049027
- https://support.google.com/admanager/answer/7506166
- https://support.google.com/admanager/answer/6147120
