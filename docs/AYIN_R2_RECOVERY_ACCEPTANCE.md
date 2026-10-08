# Isolated R2 recovery acceptance

## Scope and evidence boundary

`apps/api/src/media/r2-recovery-acceptance-cli.ts` is an opt-in operator tool. It is not imported by the API, worker, production startup or cleanup scheduler. It does not issue durable application upload sessions, write application/database state, enable the recovery admission gate, change CORS or permissions, or create credentials.

The runner exercises direct R2 protocol observations using synthetic bytes. A successful provider response, HEAD, `NoSuchUpload`, object absence, abort or DELETE never proves no delayed/future writes. Every report has `settlementProven: false` and `issuanceEnabled: false`. These remain false even when all checks pass. Physical R2 acceptance, full browser transfer, worker settlement, privacy completion and production recovery activation are separate gates.

The deliberate lost-response case discards the successful Complete result before calling the read-only reconciliation observer. Complete is sent exactly once. This is a controlled loss of the caller's receipt, not a real network-partition experiment or proof of settlement after an uncertain timeout. An actual failed/ambiguous Complete produces a failed report and retains unresolved ownership state; it is never replayed.

## Disabled by default and isolated configuration

The default command makes no provider request and exits nonzero with `DISABLED`. It neither discovers nor falls back to ordinary `R2_*` credentials. An enabled but incomplete or unsafe configuration reports `BLOCKED` before constructing a provider runtime.

All of the following must be supplied explicitly through the operator's existing secure environment:

```text
AYIN_R2_ACCEPTANCE_ENABLED=1
AYIN_R2_ACCEPTANCE_ACCOUNT_ID=<32 lowercase hexadecimal account ID>
AYIN_R2_ACCEPTANCE_BUCKET=ayin-recovery-test-<dedicated-test-suffix>
AYIN_R2_ACCEPTANCE_ACCESS_KEY_ID=<existing test-only access key>
AYIN_R2_ACCEPTANCE_SECRET_ACCESS_KEY=<existing test-only secret>
AYIN_R2_ACCEPTANCE_PREFIX=ayin-recovery-acceptance/
```

Use an already provisioned, private, isolated test bucket and existing credentials limited to that bucket. Provisioning or changing credentials, access, CORS or bucket configuration requires separate operator authorization and is not performed by this tool. Do not paste credentials into source, reports, CI logs or shell history. No production resource access is needed.

Safety gates:

- The bucket must start with `ayin-recovery-test-`, contain only the bounded lowercase ASCII test suffix accepted by the runner, and must not contain `prod` or `production` as a hyphen-delimited component. A test-looking name alone does not prove isolation; the operator must verify the bucket and credentials.
- `APP_ENV=production` and a test bucket equal to the ordinary configured `R2_BUCKET` are refused.
- The account ID is strictly validated and the HTTPS R2 endpoint is derived from it. Endpoint overrides are not accepted. The region is fixed to `auto`.
- The prefix variable must equal the literal `ayin-recovery-acceptance/`. Each invocation creates a fresh cryptographic UUID child prefix. Caller-provided run IDs, object keys and previous manifests cannot be supplied.
- Each exact new object key is checked absent before any fixture upload. An unexpected object or failed observation stops the run. No bucket/prefix inventory is used.
- Network PUT, OPTIONS and streamed byte-verification operations have 30-second deadlines and no retries; multipart/list operations use the adapter's existing bounds. Exact HEAD, abort and DELETE are additionally wrapped in an outer 30-second runner deadline so a provider transport that ignores cancellation cannot hang finalization. Signed upload grants last 60 seconds. Expiry is not settlement evidence.

## Optional origin/CORS observation

Supply the exact HTTPS origin that will perform browser uploads, without a path or trailing slash:

```text
AYIN_R2_ACCEPTANCE_ORIGIN=https://your-authorized-test-origin.example
```

With an origin, the runner sends Node OPTIONS requests to the signed SINGLE and first multipart PUT URLs. It validates the exact allowed origin, PUT method and all requested header names, case-insensitively. SINGLE requests `content-type` plus these signed binding headers:

- `x-amz-meta-ayin-upload-session`
- `x-amz-meta-ayin-source-asset`
- `x-amz-meta-ayin-identity-root`

The multipart byte PUT adds no content-type or metadata header; its OPTIONS request therefore has no `Access-Control-Request-Headers` value. Metadata was bound at multipart creation. Actual SINGLE and multipart PUT responses must return the exact allowed origin and explicitly expose `ETag`.

Without the origin, `NODE_SINGLE_CORS_PROTOCOL` and `NODE_MULTIPART_CORS_PROTOCOL` are `NOT_RUN_MISSING_ORIGIN`, and the overall result remains partial. These are Node protocol observations, not a real browser's CORS enforcement, rendering, login, close/reopen recovery or transfer acceptance. See [R2 upload configuration](R2_UPLOADS.md) for the separate CORS example. The runner never changes bucket CORS.

## Fixtures and observations

A run reserves only three generated addresses beneath its new UUID prefix:

1. `single.bin`: 38 synthetic bytes uploaded with signed session/source/full-file-root metadata. The observer must verify exact size, normalized content type, ETag and all three binding fields.
2. `multipart.bin`: a 5 MiB first part plus a 17-byte tail. ListParts must match the exact first part before resuming with only part 2. The second listing must match both exact part numbers, sizes and returned ETags. The open upload is independently observed. After one Complete with its result deliberately discarded, reconciliation must observe `NoSuchUpload` and the bound object through the production adapter.
3. `abort.bin`: a separate fresh multipart upload with one 5 MiB part. Its exact part is listed before the separately approved abort case.

SINGLE and completed multipart are downloaded from the same provider object keys with streaming exact-size limits. The runner checks GET metadata again, recomputes the shared `AYIN_SHA256_CHUNKS_V1` identity over every received byte, and independently compares SHA-256 of all bytes. It never calls unbounded `arrayBuffer()` for provider GET verification. Changed, shortened, oversized or metadata-mismatched data fails. The bytes are synthetic protocol fixtures, not playable-media acceptance.

## Running without destructive approval

After authorization to create these bounded test fixtures and after supplying the isolated environment:

```sh
corepack pnpm --filter @ayin/api proof:r2-recovery
```

This does not abort or delete anything. It leaves two objects totaling 5 MiB + 55 bytes and one 5 MiB unfinished multipart part, approximately 10 MiB total. The abort checks are `NOT_RUN_APPROVAL_REQUIRED`; the overall result is `OBSERVATIONS_PARTIAL`, exit code 1. Stored bytes and request charges may apply under the operator's existing account; no paid service, subscription or payment is created.

The JSON ownership manifest contains the dedicated bucket, generated run ID/prefix, exact three keys, known upload IDs and conservative object/upload states. It redacts credentials, account ID, signed URLs, provider diagnostics and content digests. Keep this operational manifest private. It is the review record for any later, separately approved exact cleanup. The runner cannot import a prior manifest; starting another run never cleans earlier runs.

`MAY_EXIST` and `MAY_EXIST_WITH_UNKNOWN_ID` mean an attempted write/allocation did not yield enough evidence. Unknown IDs are never guessed or discovered by a broad listing. Such state remains unresolved for operator review. Abrupt process termination can prevent returning a complete manifest; use the isolated bucket's independently reviewed retention/incident process rather than assuming this tool settled or removed anything.

## Explicitly approved destructive fixture test

Irreversible deletion/abort must be explicitly approved for the exact new run's synthetic fixtures before this mode is invoked. Existing broad code/test authorization does not silently grant that approval. The acknowledgment below records an approval already obtained; setting it is not a substitute for user approval.

Both the environment acknowledgment and CLI flag are required:

```text
AYIN_R2_ACCEPTANCE_CLEANUP_APPROVED=1
```

```sh
corepack pnpm --filter @ayin/api proof:r2-recovery --cleanup-owned-fixtures
```

This mode additionally aborts the freshly created abort-probe ID and independently requires exact ListParts `NoSuchUpload` (the observation code, `listParts` operation and HTTP 404 must all agree) plus bound-key object absence. In finalization it deletes only the two positively created objects and aborts only exact known IDs still marked created by this invocation. No recursive/prefix deletion, existing-data removal, imported key or arbitrary upload ID is accepted. Failed DELETE/abort/observation remains `INCOMPLETE`; uncertain objects and unknown allocations are retained, not guessed away.

`OBSERVATIONS_RECORDED` means only that the requested exact cleanup observations were recorded. It is not physical settlement or privacy completion. Only all requested checks, origin checks and cleanup observations succeeding yields `OBSERVATIONS_VERIFIED`, exit code 0. Disabled, blocked, partial and failed runs exit 1. Never use this exit code alone to enable production issuance.

## Offline checks and provenance

```sh
corepack pnpm --filter @ayin/api exec vitest run src/media/r2-recovery-acceptance.test.ts
corepack pnpm --filter @ayin/api run typecheck
```

Dependency-injected tests always report `SIMULATED` and do not perform network calls. A normal enabled runner reports `REAL_R2` provenance for its direct-provider path and records whether it attempted provider work. The report's status must still be checked: `REAL_R2` alone does not mean success. Provider diagnostics are never serialized on failure.

The offline suite covers default isolation, production rejection, preexisting-key refusal, unique invocation ownership, exact parts and metadata, dropped-receipt/no-replay behavior, bounded/hash-checked reads and cancellation, uncertain allocation debt, explicit destructive gating, exact cleanup failures, optional origin behavior and CORS rejection. These local synthetic results do not constitute physical R2 acceptance. No real-provider run is recorded by this implementation document.
