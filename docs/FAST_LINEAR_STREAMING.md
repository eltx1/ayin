# AYIN Creator TV — FAST / Linear Streaming Architecture

Task 75 connects the provider-neutral Creator TV orchestration introduced by Task 35 to a real owned compute path while preserving the progressive MP4 fallback.

## Selected FAST provider: owned FFmpeg linear compute

The selected Task 75 implementation is AYIN owned FFmpeg compute (providerKey: owned-ffmpeg).

AWS MediaTailor Channel Assembly was re-evaluated before implementation. It remains a possible future managed FAST option, but its VOD source model expects already-packaged HLS/DASH package manifests. AYIN's authoritative Creator TV schedule currently points at validated MP4 objects in private R2. Adding MediaTailor directly at this boundary would therefore require a separate durable VOD packaging/origin workflow before the linear provider could consume the same schedule assets.

The owned provider deliberately consumes AYIN's existing scheduled MP4 objects through MediaProcessingStorageService, which already owns authenticated R2 retrieval. R2 is still storage, not the live packager.

Production selection remains feature-gated:

- LINEAR_COMPUTE_ENABLED=1 selects OwnedLinearStreamingProvider.
- Disabled or incomplete configuration selects UnconfiguredLinearStreamingProvider.
- Progressive MP4 remains enabled in every LinearChannelPlan and is not removed by Task 75.

## Provider lifecycle

OwnedLinearStreamingProvider implements the existing LinearStreamingProvider contract:

1. getState(tvChannelId)
2. provision(plan)
3. reconcile(plan)
4. stop(tvChannelId)

Provision creates the compute resource inside the owned provider. The returned providerResourceId is the ID created by that provider operation. AYIN orchestration does not fabricate an ID.

A public HLS URL is not returned at provisioning time. The provider first starts FFmpeg, waits for a real live media playlist containing a real segment and EXT-X-PROGRAM-DATE-TIME, and only then exposes the path:

    {LINEAR_PUBLIC_BASE_URL}/{providerResourceId}/index.m3u8

The public endpoint reads the provider's real rolling playlist and real MPEG-TS segments from the owned compute output directory. Stopped, unconfigured, provisioning and error states do not expose a playable HLS URL.

## Continuous playout and transitions

For each scheduled program the provider:

- materializes the private R2 MP4 to provider-local scratch;
- calculates the source seek offset from the schedule wall clock and playbackOffsetMs;
- reads the input in real time;
- normalizes video to H.264/yuv420p and audio to AAC when audio exists;
- writes a rolling HLS live window;
- emits EXT-X-PROGRAM-DATE-TIME;
- starts each new program invocation with an HLS discontinuity;
- keeps the HLS playlist open-ended rather than writing VOD end semantics.

Sources for upcoming programs are pre-warmed while the current program is playing. If there is a schedule gap, owned compute emits a bounded black/silence filler chunk so the channel remains continuously packaged rather than turning the HLS origin into a VOD-style stop/start surface.

The FFmpeg HLS output uses append-list, program-date-time, discontinuity, independent-segment, rolling-delete and no-endlist behavior. Segment sequence numbers are derived from epoch microseconds so a new program process cannot collide with segment names from the preceding program.

## Schedule reconciliation

Creator TV remains the source of truth. CreatorTvLinearService starts a bounded periodic reconciliation loop after successful provisioning. The loop rebuilds the plan from the existing Creator TV schedule and calls the provider rather than maintaining a second schedule database.

A reconciliation that only changes future programs updates the provider plan without interrupting the active program. If the active occurrence/source/timing changed, or the provider is in ERROR, the provider performs a bounded restart and resumes from the new wall-clock offset.

The provider persists the active plan/resource identity under its output root. On API/provider process restart, configured owned compute scans those persisted running resources, restores the same provider resource ID and restarts playout. A stale pre-restart manifest does not become READY evidence: the manifest must be modified by the recovered FFmpeg process before the HLS URL is re-exposed.

## EPG

The XMLTV guide continues to be built from the exact same LinearChannelPlan as playout. No second EPG scheduling source is introduced.

GET /public/channels/:handle/tv/linear continues to return provider state, HLS availability and URL when READY, XMLTV, ad markers, and progressive MP4 fallback capability.

## Ad markers

Creator TV ad-break intents remain SCTE35_INTENT in the schedule plan.

Task 75 originally preserved these intents as provider-neutral metadata only. Task 76 adds the monetization translation boundary: when explicitly enabled, the owned HLS packager emits Google-supported EXT-X-CUE-OUT / EXT-X-CUE-IN splice markers with required DURATION and stable BREAKID values.

Task 76 still does not generate or claim SCTE-35 binary. SCTE35_INTENT remains the upstream semantic intent, while the concrete HLS provider equivalent is HLS_CUE_OUT_IN. See docs/TASK76_SSAI_DAI.md for the account gates, DAI selection, fallback, and reconciliation rules.

## Failure recovery and monitoring

The provider never retries forever.

LINEAR_MAX_RECOVERY_ATTEMPTS bounds FFmpeg/source retry attempts with capped backoff. When the retry budget is exhausted, state becomes ERROR, HLS is withdrawn, and Creator TV remains playable through the existing progressive MP4 fallback. A later schedule reconciliation may attempt a clean provider restart.

LinearOutputState.monitoring exposes:

- runningOccurrenceKey;
- lastTransitionAt;
- signed scheduleDriftMs;
- maximum absolute maxScheduleDriftMs;
- recoveryCount;
- lastManifestAt;
- lastError.

For an initial mid-program join the provider seeks directly to the calculated wall-clock source position, so start-lateness is not reported as a false program-transition drift. Subsequent scheduled transitions are measured against their planned startsAt.

## Public owned-compute output

The provider exposes only these public object shapes under its resource route:

    GET /public/linear/{providerResourceId}/master.m3u8
    GET /public/linear/{providerResourceId}/index.m3u8
    GET /public/linear/{providerResourceId}/segment-{sequence}.ts

Arbitrary filesystem paths are never accepted. The resource must be known, running and READY.

## Production environment

Example configuration:

    LINEAR_COMPUTE_ENABLED=0
    LINEAR_PUBLIC_BASE_URL=https://api.ayin.stream/public/linear
    LINEAR_OUTPUT_ROOT=/home/ayin/runtime/linear
    LINEAR_SEGMENT_DURATION_SECONDS=4
    LINEAR_RECONCILE_INTERVAL_SECONDS=30
    LINEAR_MAX_RECOVERY_ATTEMPTS=3

Production validation requires an HTTPS public base URL ending at /public/linear, an absolute output root, and bounded numeric settings when owned compute is enabled.

Keep LINEAR_COMPUTE_ENABLED=0 until the production host has enough CPU/disk/network capacity and Task 75's real channel checks have been exercised there. This task intentionally does not remove the safe MP4 path.

## End-to-end acceptance channel

apps/api/test/owned-linear-streaming-provider.integration.test.ts creates a real Task 75 channel without mocking the packager:

1. FFmpeg generates two real H.264/AAC MP4 source assets.
2. The provider provisions an owned compute resource.
3. The test waits until the provider observes a real HLS playlist and returns its real manifest URL.
4. The URL is fetched over HTTP and a real MPEG-TS segment is fetched from the returned manifest.
5. The test waits for the second scheduled program.
6. It verifies discontinuity handling and the HLS ad marker.
7. It asserts that maxScheduleDriftMs remains below the integration acceptance bound.
8. It reconciles a future schedule change without changing the provider resource ID.
9. It stops the resource and verifies the old manifest URL is no longer served.

The test runs in the existing integration phase after the repository's pinned FFmpeg runtime is installed.

## Rollout rule

Task 75 adds a real HLS/FAST provider path, but progressive MP4 remains the production safety net until real linear production stability is proven. READY means a provider-produced manifest and segment were observed. Any other provider state leaves the existing fallback intact.
