# Isolated owned-fixture R2/browser acceptance

Status: tooling and offline checks only. No live provider/browser proof is implied by this document or by a local test pass. Production upload recovery stays disabled.

## Required authorization and deployment

This is a separate manual production boundary from the test-bucket-only runner. Do not dispatch it before explicit approval of the exact fixture and irreversible cleanup scope below. Code review, merging, deployment, existing credentials, and a green workflow are not substitutes for that approval.

1. Review this tooling and the V2 exact-length signing implementation, then pass the ordinary quality gates and deploy the reviewed main commit with recovery V2 disabled. An earlier release without exact-length multipart signing cannot provide this evidence.
2. Verify the exact current main SHA has a successful `Task quality gates` push run and `Production deployment` run. The workflow repeats these checks, and the remote runner also verifies the same SHA at the already-active `/home/ayin/htdocs/current` release. It refuses dirty tracked source and checks signature capability before allocating anything.
3. Obtain explicit approval for all three new synthetic fixture keys, at most three multipart allocations, the extra 39-byte rejection probe, and irreversible cleanup of only this run's created fixture objects/known upload IDs. A previous test's prefix may not be substituted.
4. Dispatch `Owned R2 fixture acceptance` on main exactly once, using the approved inputs below. Do not use GitHub's rerun command. Once the provider runner begins its manifest-backed preflight, a preflight failure also reserves the run UUID; earlier CI/browser prerequisite failures may happen before that reservation. Retaining any existing reservation prevents unsafe replay after uncertain execution.

Inputs:

- `release_sha`: the reviewed, successful, already-deployed 40-character lowercase main SHA
- `run_id`: `34c4947c-ba13-4fc9-9087-0d1db8cc4d28`
- `confirm_prefix`: `ayin-recovery-acceptance/34c4947c-ba13-4fc9-9087-0d1db8cc4d28/`
- `cleanup_ack`: `DELETE_ONLY_CREATED_FIXTURES`

The workflow is manual-dispatch-only, shares the production deployment concurrency lock, rejects reruns, and never deploys, bootstraps storage, changes CORS/lifecycle policy, or enables a feature flag. The current protocol deliberately has no configurable production bucket, prefix, source, credential path or target hostname.

## Exact approved resource scope

Existing bucket: `ayin-production-media`.

Under only the fixed prefix above:

- `small.bin`: 38 synthetic bytes, a single final multipart part
- `multipart.bin`: 5 MiB plus 17 synthetic bytes, two multipart parts
- `abort.bin`: 5 MiB synthetic bytes, one multipart part, then abort

All three sources use multipart initiation, including the tiny fixture. The total planned retained synthetic source bytes are at most 10,485,815. There are four successful browser PUTs plus one intentional 39-byte rejected PUT signed for 38 bytes. This is a bounded workload, not a promise about provider billing, version retention, same-size replay or arbitrary future behavior.

Before the first mutation, all three exact keys must have a verified HEAD 404. Each also receives one bounded multipart collision read with `prefix` equal to that full fixture key and `max-uploads=1`. Any returned allocation, neighboring prefix row, truncation or uncertain result stops the run. Foreign keys/IDs are neither adopted nor printed. No broad listing or prefix deletion is available.

No creator channels, actual user media, database records, credentials, persistent access, account settings or bucket configuration are changed. These bytes are not playable video and are never passed into ingest, transcode, publishing, playback, ads or revenue workflows.

## Transport and credential boundary

The workflow reuses the existing `AYIN_DEPLOY_SSH_KEY`, isolated `ayin` account at `13.52.116.200`, and host fingerprint `SHA256:YoUNEx7Aizhzl99TReL4kGCyUY6KopzrPuPgRmhDC0Y`. Key acquisition uses the existing bounded helper; pin mismatch fails closed. SSH disables implicit configuration, requires the pinned known-host file and explicit identity, and checks the AYIN account boundaries. Nothing is copied to production and no bootstrap script runs.

The provider runner executes only from the exact active release through `deploy/run-with-env.cjs /home/ayin/env/api.env`. Permanent service credentials remain there. They are never copied into CI, browser storage, logs or artifacts. Only short-lived, exact-length, exact-part grants travel over one private SSH JSONL pipe to Chromium. The configured R2 origin is attested in the same pinned SSH session and every grant must match it exactly.

Chromium starts with a clean context at `https://ayin.stream`, blocks service workers, and uploads a deterministic Blob with `credentials: omit`, `redirect: error` and no JavaScript-set Content-Length. Playwright independently observes the actual outgoing Content-Length, Origin, credential absence and network response; page-returned JSON alone is insufficient. Positive browser responses must expose an ETag through the current CORS policy, but the ETag never supplies Complete's part inventory. No HAR, trace, video, screenshot, URL/header dump or raw child stderr is saved.

Before multipart part 2, the browser context is recreated and navigates to AYIN again. The provider has already independently listed and verified part 1, and issues fresh authorization only for the remaining 17 bytes. It never uploads part 1 a second time. This is a provider/browser resume primitive, not a claim of full creator UI or persisted application recovery acceptance.

## Observations and cleanup

The runner establishes the following in order:

1. The deployed signer binds `content-length;host`, changes signature when expected length changes, and rejects a zero expected length without provider I/O.
2. An oversized 39-byte browser Blob using a grant signed for 38 receives a visible actual HTTP 403 `SignatureDoesNotMatch`, followed by an authoritative empty ListParts result. A generic CORS/network error is inconclusive and cannot pass the negative control.
3. The correct 38-byte Blob succeeds, provider ListParts verifies its exact size and supplies its ETag, and one Complete is issued.
4. Multipart part 1 succeeds; provider inventory is verified; a fresh browser context uploads part 2; provider inventory supplies both completion ETags.
5. The returned second Complete receipt/ETag is deliberately discarded once, with no replay. Independent completion observation plus HEAD metadata and a bounded direct GET establish the created object's binding, exact bytes, SHA256(file), and versioned AYIN chunk-root identity. This simulates loss at the application-receipt boundary; a truly failed/ambiguous Complete transport remains UNKNOWN debt and is never called proven.
6. The third known multipart allocation is aborted once. Strict provider NoSuchUpload and exact object absence are observed.
7. In finally, only acknowledged, owned completed fixture keys are deleted, after re-verifying their identity. Known uncompleted allocations are aborted once. The first two keys then receive exact HEAD absence observations. A successful delete/abort is not by itself sufficient to pass these observations.

Creating and destructive dispatches, including browser PUTs, are spaced at least 1.1 seconds apart for the same key, with the next mutation anchored after the browser result or timeout rather than grant issuance to avoid R2's per-key write limit. This spacing is not settlement evidence. There are no automatic retries after throttling, timeout, an unknown create ID, uncertain Complete, abort or deletion.

A point-in-time provider observation, verified payload, URL expiry, successful abort or successful DELETE is not a guarantee of eternal absence or future write settlement. This runner does not clear application debt, change historical V1 proof semantics, certify replay-proof grants, or activate V2. Any later activation needs its own reviewed decision and configuration.

## Durable manifest and failure handling

Before any provider I/O, the host reserves `/home/ayin/.r2-acceptance-manifests/34c4947c-ba13-4fc9-9087-0d1db8cc4d28.json` with O_EXCL, a private owned directory, mode 0600, validated parent-directory fsync before reservation, file/child-directory fsync, and atomic durable updates. It journals every mutation before dispatch, exact owned keys, known allocation IDs, and unknown states. It never stores grants, signing URLs, credentials, response bodies or raw provider errors. The file remains even on success and must not be deleted to permit rerunning.

Unknown CREATE has no guessed cleanup. Unknown Complete has no replay, abort or delete; its created key/known ID and debt remain in the manifest. Unknown abort/delete is also never blindly retried. A crash, SSH interruption, runner cancellation or missing proof artifact is inconclusive. Retain the manifest and have an authorized operator review that exact owned scope before any further mutation. There is no broad reconciliation or automatic remediation path in this tool.

Each provider request/body is time- and byte-bounded, with a whole-run request/response budget; protocol messages and queues are bounded; browser fetch, navigation, SSH connection and the overall driver have deadlines. A deadline stops waiting, not necessarily an already-dispatched remote operation. That is why the durable unknown state and permanent no-replay reservation are mandatory.

Only `owned-r2-proof.json`, reconstructed from allowlisted fields, is uploaded as a 30-day artifact. It includes fixture addresses, release SHA, sanitized stage/state observations and debt booleans. Upload IDs, configured account/host, credentials, private source details, URLs, request headers and raw errors remain absent. If the pipe fails before a valid proof arrives, there may be no artifact; inspect the retained host manifest rather than repeating the test.

Driver failure logs include only a fixed local phase and sanitized code. The exact `UNSAFE_MANIFEST_PARENT` startup diagnostic is accepted only after the trusted ready message and before any grant; all other remote failure messages are rejected by the existing protocol validation. A phase or error code does not establish absence of provider writes, remove a reservation, or authorize replay or cleanup.

Browser failure diagnostics may also include the fixed page outcome, HTTP status integers, and whether an observed response's allow-origin header matches AYIN or `*`; unavailable values are `null`. This header observation alone does not prove CORS acceptance. These diagnostics never include header values, URLs, response bodies, or credentials, and cannot replace the required browser-visible 403 `SignatureDoesNotMatch` negative control.

## Offline validation

Run without any live account or provider credentials:

```sh
node --test deploy/media/r2-owned-fixture-provider.test.mjs deploy/media/r2-owned-fixture-browser.test.mjs
```

The tests use deterministic in-memory provider doubles and stubbed page/network observation. They exercise scope/default refusal, signature capability, collision refusal, exclusive manifest reservation/replay blocking, unknown create/complete retention, authoritative completion parts, exact cleanup, readback corruption, protocol and timeout bounds, grant validation, and secret-free proof projection. They do not establish real R2 behavior or CORS acceptance.

Invoking either runner without the full explicit execution and exact-scope arguments refuses before provider/network/browser work. The existing test-only acceptance runner is unchanged and has no production fallback.
