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

The Mux provider is selected only when all production gates are present:

- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`
- `MUX_WEBHOOK_SIGNING_SECRET`
- `MUX_LIVE_PRODUCTION_ENABLED=1`

If any gate is missing, the runtime selects `UnconfiguredLiveIngestProvider` and provider
operations fail closed rather than creating a fake stream.

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

These deterministic fixtures satisfy CI without requiring production credentials or creating billable
resources. A deployment can additionally run the Task 72 Mux test-mode control-plane proof when an
operator explicitly supplies the test credentials and opt-in flag.

## Advertising

The live response continues to expose AYIN's existing client-side `IMA_CLIENT_BREAK` boundary.
Task 73 does not enable or claim Google Ad Manager DAI. DAI remains a separate integration/proof
because its live manifest conditioning and cue/SCTE-35 requirements are outside the Mux provider
adapter lifecycle implemented here.
