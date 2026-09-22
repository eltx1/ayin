# AYIN Task 76 — Linear SSAI / Google Ad Manager DAI

Task 76 is deliberately conservative: AYIN only emits ad signaling that the selected owned HLS packager can actually place in the live manifest, and it never converts the existing `SCTE35_INTENT` label into fake SCTE-35 binary data.

## Official Google DAI boundary

Google Ad Manager DAI for live linear HLS supports `EXT-X-CUE-OUT` / `EXT-X-CUE-IN` splice points. `DURATION` is required for the cue-out form used by AYIN, and `BREAKID` is the supported key/value attached to that cue-out.

Task 76 therefore translates an AYIN ad opportunity into:

```text
#EXT-X-CUE-OUT:DURATION=30,BREAKID=ayin-...
...replaceable live content segments...
#EXT-X-CUE-IN
```

AYIN does **not** emit:

- `SCTE35-OUT` / `SCTE35-IN`;
- `EXT-OATCLS-SCTE35`;
- base64 SCTE-35 payloads;
- claims that SCTE-35 exists when only `SCTE35_INTENT` metadata exists.

Google documents actual DATERANGE or binary SCTE-35 as supported only when valid SCTE-35 payloads are present and decode to recognized splice/provider opportunity types.

Official references used for Task 76:

- Google Ad Manager Help — **Live linear stream ad break encoding (HLS)**:
  https://support.google.com/admanager/answer/13049027
- Google Ad Manager Help — **HLS integration**:
  https://support.google.com/admanager/answer/13049537
- Google Ad Manager Help — **Set up a live stream for DAI**:
  https://support.google.com/admanager/answer/7294289
- Google Ad Manager Help — **Integrate with DAI using the API**:
  https://support.google.com/admanager/answer/9838939
- Google Ad Manager Help — **Export DAI stream data in real time**:
  https://support.google.com/admanager/answer/11118057

DAI availability is account-dependent. AYIN does not assume that a GAM account has DAI. A real asset key must already exist in an eligible Google Ad Manager DAI live stream before AYIN can select the DAI playback URL.

## Selected packager capability

Task 75 selected AYIN-owned FFmpeg compute. The provider owns the rolling HLS media playlist and can therefore insert valid HLS cue tags at segment boundaries.

The separate real-live provider selected in Task 73 is Mux. Current Mux Live Stream API documentation exposes ingest, playback, metadata, captions, latency, reconnect, and simulcast controls, but AYIN does not have a documented Mux control-plane operation that inserts Google-compatible SCTE-35/CUE splice signaling into Mux-packaged HLS. Task 76 therefore **does not claim or fabricate live SSAI on Mux**. Existing live playback keeps its client-side IMA ad-break hook.

Task 76 adds a single-variant HLS master playlist:

```text
/public/linear/{providerResourceId}/master.m3u8
```

The master points to the real Task 75 media playlist. It is HLS v3 and carries explicit CODECS and RESOLUTION attributes required by the current Google DAI HLS integration guidance. The owned linear output is normalized to a stable 1280x720 H.264 High@4.1/AAC profile with bounded bitrate so the master accurately describes the media. This is the content-source URL that can be configured in an eligible Google DAI live stream.

Cue translation is performed only when Task 76 signaling is enabled. Old Task 75 persisted resources without the new signaling field remain content-playable and receive no Task 76 cues until reconciled.

## Break scheduling

Creator TV remains the schedule source of truth.

Break opportunities are derived from the existing video-ad policy and creator metadata:

- global video ads must be enabled;
- mid-roll must be enabled;
- creator `DISABLED` suppresses breaks;
- creator `CUSTOM` uses the supplied offsets;
- automatic mode uses the existing mid-roll interval;
- offsets are sorted and deduplicated;
- a break that would extend beyond the program is rejected;
- overlapping breaks are rejected.

The break duration is **not guessed**. `LINEAR_SSAI_BREAK_DURATION_SECONDS` must be explicitly configured before signaling can be enabled.

Each opportunity gets a stable ID derived from:

- Creator TV channel ID;
- schedule occurrence key;
- offset;
- configured duration.

The same ID is emitted as the HLS `BREAKID` and exposed in AYIN analytics as `opportunityId`.

## Segment-boundary cue translation

The owned HLS provider parses its own `EXT-X-PROGRAM-DATE-TIME`, `EXTINF`, and segment sequence.

A scheduled opportunity begins at the first available segment boundary at or after the requested wall-clock time. `CUE-IN` is placed at the first segment boundary at or after the requested duration.

This gives Google an explicit return-to-content marker while keeping the declared cue duration stable across rolling-manifest refreshes.

The manifest renderer never writes two identical break IDs in one playlist and rejects overlapping opportunity windows.

Because Task 75 uses an 18-segment rolling live window, Task 76 also refuses a configured break duration that would exceed 16 segment durations. This ensures the cue-out remains observable until the matching cue-in can be emitted, including on the short-segment test profile.

## Google DAI / SSAI selection

DAI remains default-off. AYIN selects Google DAI SSB playback only when all of the following are true:

1. `LINEAR_SSAI_ENABLED=1`;
2. neither the global advertising emergency kill switch nor `LINEAR_SSAI_KILL_SWITCH` is active;
3. an explicit break duration exists;
4. `GAM_DAI_ENABLED=1`;
5. a real `GAM_DAI_ASSET_KEY` is configured;
6. existing GAM production configuration is complete, production-enabled, test mode is off, and the existing GAM kill switch is open;
7. the owned linear provider is `READY` and exposes a real master manifest URL;
8. all scheduled breaks in the plan are compatible with this Google DAI path.

Task 76 does not call a Google control-plane API to fabricate or provision an asset key because AYIN has no DAI account/API credential contract in the repository. The asset key must come from the real Ad Manager DAI live-stream setup.

The SSB playback URL is derived only from that configured real asset key:

```text
https://pubads.g.doubleclick.net/ssai/event/{assetKey}/master.m3u8
```

## Direct and house ad safety

This Task 76 DAI integration does not pretend that an arbitrary external VAST or AYIN house creative has been inserted server-side.

If the current linear plan contains a `DIRECT` or `HOUSE` opportunity, Google DAI selection is blocked for that capability response and the client keeps the existing IMA/MP4 path.

## Failure and fallback

Progressive MP4 is still the content safety path.

Creator TV playback chooses:

- Google DAI SSB + the live HLS player when DAI is genuinely available;
- otherwise progressive MP4 + existing client-side Google IMA.

If DAI HLS playback exhausts the live player's bounded recovery and reports a fatal error, Creator TV switches to the MP4/IMA path at the current conceptual wall-clock position. Ad insertion failure therefore cannot make the underlying program unavailable.

The global advertising emergency kill switch and the Task 76-specific kill switch both disable new SSAI signaling/DAI selection without disabling Creator TV content.

## Event reconciliation and revenue truth

Task 76 distinguishes **opportunity lifecycle** from **ad delivery/revenue**.

AYIN records:

- `TV_SSAI_SELECTED`;
- `TV_SSAI_FALLBACK`;
- `TV_AD_BREAK_OPEN`;
- `TV_AD_BREAK_CLOSE`.

Those events carry:

- local `opportunityId` / manifest `BREAKID`;
- channel ID;
- video ID when known;
- occurrence key;
- owned provider resource ID;
- configured Google DAI asset key;
- requested break duration and source.

These events prove when AYIN scheduled and exposed an opportunity. They are **not** impressions, fills, or revenue.

With server-side beaconing, Google remains authoritative for actual DAI fill/impression/revenue. Google's DAI real-time export exposes its own asset/break and duration fields. AYIN does not claim that Google's live sequential `break_id` is identical to AYIN's HLS `BREAKID`.

No Task 76 code synthesizes GAM revenue, impressions, or fill events.

## Environment controls

Default-safe example:

```text
LINEAR_SSAI_ENABLED=0
LINEAR_SSAI_KILL_SWITCH=0
LINEAR_SSAI_BREAK_DURATION_SECONDS=
GAM_DAI_ENABLED=0
GAM_DAI_ASSET_KEY=
```

Production validation requires:

- owned linear compute before SSAI;
- bounded explicit break duration;
- SSAI before DAI;
- production GAM with test mode off before DAI;
- a syntactically valid non-empty DAI asset key.

## Validation

Task 76 acceptance covers:

- feature and kill-switch defaults;
- deterministic opportunity IDs;
- duplicate and overlap suppression;
- CUE-OUT/CUE-IN manifest placement;
- explicit break duration;
- return-to-content cue;
- absence of fabricated SCTE-35 fields;
- real FFmpeg HLS master/media/segment output;
- no duplicate BREAKID in a rolling manifest;
- DAI selection only when all gates are ready;
- direct/house fallback to client IMA;
- TV-focusable DAI playback through the live player;
- DAI fatal fallback to progressive MP4 + IMA;
- analytics attribution identifiers.
