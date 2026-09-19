# AYIN live streaming foundation

Task 34 adds the repository-side live product boundary without changing the VOD architecture.
Task 72 selects the intended production provider architecture without enabling production traffic.

## Architecture

AYIN's existing R2 media path remains the source/storage path for uploaded VOD MP4 assets. R2
object storage is **not** treated as a live ingest, transcoding, packaging or origin service.

Live sessions are represented by `LiveStream` records with scheduled lifecycle state, provider
identifiers, playback/ingest descriptors, chat policy and client-side ad-break eligibility.
`LiveChatMessage` and `LiveModerationAction` provide a bounded live-chat and moderation audit
model.

`LiveIngestProvider` is the provider-neutral boundary. Production implementations must provision
an actual ingest/transcoding service and return its ingest endpoint and playback URL. The default
adapter remains deliberately unconfigured and returns no fake stream.

The Task 34 interface currently has AYIN generate a stream key before provider provisioning. Task 72
found that the selected managed provider, Mux Video, generates its broadcast key in the provider
control plane. **Task 72 does not change the running interface or production behavior.** Task 73 must
revise the adapter contract so provider-issued keys/passphrases can be returned once to the creator
while AYIN stores only non-reversible hashes.

## Task 72 provider decision

The detailed ADR is `docs/ADR_0072_LIVE_PROVIDER.md`.

- selected implementation target: **Mux Video**
- fallback: **Amazon IVS Low-Latency Streaming**
- production provider connected: **no**
- real provider proof completed: **no — Mux credentials are not available in the task environment**
- safe test-mode proof harness: available, opt-in only
- current runtime adapter: **UnconfiguredLiveIngestProvider**

The decision was based on a weighted review of ingest, latency, scaling/CDN, lifecycle, API
maturity, advertising/Google paths, DRM, analytics, cost/commitments and portability. It was not
based on the lowest advertised unit price.

## Creator workflow

Current Task 34 runtime behavior remains:

1. Create or schedule a live session in Studio.
2. Provision the session only after a real live provider is configured.
3. Copy the one-time broadcast credentials into the encoder.
4. Move the session to `LIVE` only when a provider playback output exists.
5. End the session through AYIN so the provider stop hook can execute.

Task 73 will adapt step 3 to provider-generated Mux credentials and validate SRT/RTMPS with a real
encoder before production enablement.

Chat can be disabled/enabled per stream. Creator moderation can hide or remove individual messages
and records a moderation action.

## Advertising and analytics

The public live response exposes an `IMA_CLIENT_BREAK` hook only when the stream allows ad breaks.
This preserves the existing client-side Google IMA integration boundary. Mux has official Google
IMA client-side guidance, but Task 72 does **not** claim Google Ad Manager DAI is production-ready.

Google DAI remains a separate proof because current Google documentation requires specific
HLS/DASH and live ad-break signaling behavior, including SCTE-35/cue handling. Task 73 must leave DAI
disabled until that path is verified.

Live analytics event names cover page view, playback start/complete, chat and ad-break opportunity.
Mux Data may supplement these signals later but does not replace AYIN-owned analytics.

## External prerequisite

The vendor decision is complete, but production verification remains externally blocked until AYIN
has real Mux credentials and completes the Task 73 encoder/player lifecycle proof. No production
Mux stream, account connection, Google DAI integration, or production ad fill is claimed by Task 72.

For the optional test-mode control-plane proof:

```bash
MUX_TOKEN_ID=... \
MUX_TOKEN_SECRET=... \
MUX_TASK72_PROOF=1 \
pnpm --filter @ayin/api run proof:live-provider
```

Without credentials and the explicit opt-in, the proof performs no network request.
The proof command also exits non-zero unless the result is `VERIFIED`, so CI or operator scripts cannot mistake a blocked proof for a successful provider verification.
