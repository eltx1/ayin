# AYIN live streaming

Task 34 established the provider-neutral live product boundary. Task 72 selected **Mux Video** as
the implementation target with Amazon IVS as the fallback candidate. Task 73 implements the Mux
adapter without changing AYIN's R2-based VOD source-of-truth architecture.

## Runtime architecture

`LiveIngestProvider` owns provider-issued broadcast credentials and the provider lifecycle. AYIN
stores only:

- the provider key and provider live-stream ID;
- the non-secret RTMPS ingest endpoint;
- the HLS playback URL;
- a SHA-256 hash of the current stream key for internal security/audit semantics.

AYIN does **not** persist the raw Mux stream key, SRT passphrase, or constructed SRT URL. Provision
and rotate responses return the encoder credentials once to Creator Studio and subsequent status,
list, diagnostics, and public responses do not return them.

The Mux control-plane adapter is selected when all three control credentials are present:

- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`
- `MUX_WEBHOOK_SIGNING_SECRET`

`MUX_LIVE_PRODUCTION_ENABLED=1` is a separate creation/rotation kill switch. Turning that flag
off blocks new Mux resources and credential rotation, but AYIN deliberately retains authenticated
status, stop/delete, recording cleanup, and signed-webhook control for resources that already exist.
If the three control credentials are incomplete, the runtime falls back to
`UnconfiguredLiveIngestProvider` and fails closed.

## Creator workflow

1. Create or schedule a live session in Creator Studio.
2. Provision the session. AYIN creates one Mux Live Stream and returns:
   - RTMPS server: `rtmps://global-live.mux.com:443/app`
   - a one-time stream key
   - an SRT URL when Mux supplies an SRT passphrase
   - the HLS playback URL
3. Copy the one-time encoder credentials into OBS or another supported encoder.
4. Start the encoder and synchronize status, or allow the signed Mux webhook to update AYIN.
5. AYIN does **not** mark the session `LIVE` merely because an encoder connected or recording
   started. The session becomes `LIVE` only after Mux reports `video.live_stream.active` or the
   Mux API reports `status=active`, which is the provider evidence that playback is available.
6. Rotate credentials through the dedicated rotation action when required. The replacement secret
   is shown once and the stored hash is replaced.
7. End or cancel the session through AYIN. AYIN disables the Mux live stream so the encoder is
   disconnected and new ingest is rejected.

Creator Studio displays the RTMPS server separately from the one-time stream key so it can be pasted
directly into OBS Custom Streaming Server settings. The optional SRT URL is displayed as a single
one-time value.

## Provider lifecycle and webhooks

Mux webhooks are accepted at:

`POST /webhooks/mux`

The API is configured with Nest/Fastify raw-body support. AYIN verifies the `mux-signature` against
the raw request body and `MUX_WEBHOOK_SIGNING_SECRET`, uses a five-minute timestamp tolerance, and
rejects missing, forged, or stale signatures before processing an event.

Normalized lifecycle handling:

| Mux event                        | AYIN evidence  | State effect                                              |
| -------------------------------- | -------------- | --------------------------------------------------------- |
| `video.live_stream.connected`    | `CONNECTED`    | Does not mark LIVE                                        |
| `video.live_stream.recording`    | `STARTED`      | Does not mark LIVE                                        |
| `video.live_stream.active`       | `PLAYABLE`     | Marks LIVE if not already ended/cancelled                 |
| `video.live_stream.disconnected` | `DISCONNECTED` | Keeps the existing state during reconnect window          |
| `video.live_stream.idle`         | `ENDED`        | Ends an active session                                    |
| `video.live_stream.disabled`     | `ENDED`        | Ends the session                                          |
| `video.live_stream.deleted`      | `ENDED`        | Ends the session                                          |
| `video.live_stream.warning`      | `ERROR`        | Recorded as provider error evidence; warning is non-fatal |

Manual `LIVE` requests also call Mux status synchronization first and return
`LIVE_PROVIDER_NOT_PLAYABLE` until provider evidence is playable.

## Post-live recording handoff

Each Mux live session creates a Mux asset with a requested `highest` static MP4 rendition. AYIN
treats Mux as temporary live/recording infrastructure rather than the long-term VOD source of truth.

Signed Mux asset events are ordered/deduplicated with the persisted provider event ID and timestamp.
The Static Renditions API sends `video.asset.static_rendition.ready` with the individual rendition
payload, so AYIN uses its `asset_id` and rendition name to retrieve the parent Mux asset before
constructing the download URL. The API response must confirm a public playback ID and a ready MP4
rendition before handoff begins.

The background handoff worker then:

1. streams the Mux MP4 directly into a bounded multipart R2 upload without buffering the complete
   recording in API memory or local disk;
2. verifies the completed R2 object size;
3. creates an AYIN VOD draft for the channel and links the R2 source `MediaAsset`;
4. enqueues that source through AYIN's existing media-processing pipeline;
5. only after the VOD processing job is safely queued, deletes the temporary Mux recording asset.

The worker is retryable, detects stale copying attempts, caps retry attempts, and keeps
`CLEANUP_PENDING` when Mux cleanup fails so a copied recording is not lost or recopied merely
because provider deletion failed.

## Operational diagnostics

Authenticated creators/operators can synchronize a specific session with:

`POST /studio/live/:id/sync`

Safe diagnostics are available at:

`GET /studio/live/:id/diagnostics`

Diagnostics expose provider readiness, enabled protocols, missing configuration **names**, current
provider evidence, provider resource ID, and playback URL. They never return API token values,
webhook secrets, stream keys, SRT passphrases, authorization headers, or provider response bodies.

Provider HTTP errors are reduced to a sanitized status/code and do not surface Mux response bodies,
because successful Mux live-resource responses can contain broadcast secrets.

## Testing

Task 73 includes deterministic provider integration coverage that exercises the real adapter code
against a Mux-shaped HTTP fixture:

- provision;
- HLS/RTMPS/SRT encoder configuration;
- provider status synchronization;
- playable evidence;
- stream-key rotation;
- signed webhook verification and replay-window enforcement;
- stop/disable;
- safe status responses with no stream-key/passphrase leakage.

Unit coverage also verifies that AYIN does not mark a session LIVE on connected-only evidence and
that the only persisted stream-key value is its SHA-256 hash.

Deterministic fixtures keep ordinary CI repeatable, but Task 73 also has a credential-gated real Mux
control-plane proof. The real proof is intentionally a required acceptance signal rather than a
substitute fixture: it creates a Mux test live stream, verifies returned ingest/playback identifiers,
rotates the provider stream key, disables the stream, and deletes the test resource without logging
the one-time key. Mux currently exposes live streaming only on paid plans; test live streams are free
to run on an eligible paid account, but a Free-plan organization cannot pass the real live-create
gate.

## Advertising

The live response continues to expose AYIN's existing client-side `IMA_CLIENT_BREAK` boundary.
Task 73 does not enable or claim Google Ad Manager DAI. DAI remains a separate integration/proof
because its live manifest conditioning and cue/SCTE-35 requirements are outside the Mux provider
adapter lifecycle implemented here.
