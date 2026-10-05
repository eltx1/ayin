# Bounded R2 upload observations

## Scope and source baseline

This is the first prerequisite for durable upload recovery, prepared on upload-authority candidate `89553def54e2b9141ed67ac7aff0aac94b6b49bf`, whose tree was merged and verified live as `c8234f8897d029860ab4d7e6f82c202ed4b1d8eb`. The publication candidate also preserves the separately validated optional-mysql2 correction `7501762e1866c7607f03d0c53b88a21cc0c7741e`. It changes only the existing R2 adapter's ListParts/ListMultipartUploads observation boundary and the bounded handling of provider error XML. It does not implement durable sessions, renew bearer tokens, change creation/authority policy, enable cleanup, replay completion or publish content.

The existing `Promise<ExistingUploadPart[]>` and `Promise<AbandonedMultipartUpload[]>` interfaces remain intact. A successful result now means every provider page was observed within the explicit safety bounds. It is not a transactional snapshot: storage can change concurrently. Any failed, malformed, limited or timed-out observation rejects rather than returning an empty or partially complete result.

## Primary protocol references

Reviewed current primary documentation on 2026-10-05:

- [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/) identifies support for `max-parts`/`part-number-marker` and the multipart inventory's paired key/upload-ID markers, maximum page size and URL encoding.
- [S3 ListParts](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListParts.html) specifies a maximum of 1,000 parts per response and continuation using `NextPartNumberMarker`. A truncated part page's next marker identifies its last listed part.
- [S3 ListMultipartUploads](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListMultipartUploads.html) specifies a maximum of 1,000 uploads per response, continuation with both returned markers, and URL encoding for keys, key markers and prefix. Upload IDs remain opaque; the adapter does not invent lexical ordering for them.
- [Cloudflare R2 errors](https://developers.cloudflare.com/r2/api/error-codes/) identifies `NoSuchUpload` as an HTTP 404 upload-not-found condition and distinguishes provider service failures.

## Implemented boundary

- Requests explicitly use 1,000-row pages. ListParts follows strictly increasing part markers; inventory follows the complete pair of returned markers and rejects repeated pairs.
- Both methods reject inconsistent response identity, malformed or duplicate rows, invalid numeric/date fields, missing continuation metadata, unexpected grouping and structurally invalid XML. Inventory keys are URL-decoded exactly once, checked against the requested prefix and kept distinct by key plus upload ID.
- Limits are 10,000 returned items, 100 pages, 2 MiB per response, 32 MiB across the observation, 20,000 XML nodes per page, bounded XML depth and a single 30-second deadline spanning requests and body reads. Exceeding a limit fails closed, including a truncated final permitted page. These are observation safety limits, not new business quotas.
- The bounded XML subset rejects DTDs, external entities, malformed UTF-8, unbalanced documents and mixed-content scalar fields. It handles XML entity escaping and the provider's ordinary default-namespace response shape. It is not a general-purpose XML implementation.
- Fetch and body timeouts abort/cancel outstanding work. A response arriving after timeout is cancelled. There are no automatic retries.
- `MediaStorageObservationError` exposes only a sanitized code, operation and optional HTTP status. Codes distinguish `NO_SUCH_UPLOAD`, `PROVIDER_ERROR`, `INVALID_RESPONSE`, `OBSERVATION_LIMIT_EXCEEDED` and `OBSERVATION_TIMEOUT`. Only a structurally verified `NoSuchUpload` error with HTTP 404 from ListParts establishes that missing-upload observation. It is not proof that a final object does not exist.
- Shared SigV4 error-body reads are capped at 64 KiB; verified provider codes are additive metadata on the existing `R2HttpError`. No provider diagnostics, object keys or signed URLs appear in the new observation error.
- The existing cleanup consumer awaits the complete inventory before acting. It needs no source change: a regression invokes the real cleanup method and verifies a later-page provider failure causes no database lookup, abort or deletion.

## Regression-first and local verification

Before implementation, the selected first regression run failed 47 cases and passed only the genuine complete-empty observation. Two timeout cases were excluded from that initial red subset, rather than represented as passing evidence.

The first implementation passed all 50 initial cases. Expanded coverage includes exact 10,000-item boundaries, page and aggregate-byte exhaustion, later-page failure, paired cursors, body/fetch/whole-operation deadlines, post-timeout cancellation, UTF-8 versus transport failure, malformed provider errors, and the existing cleanup consumer.

The intermediate full API source run passed 100 files / 486 tests, including 65 new observation cases. The final expanded source run passed **100 files / 493 tests**, including **72 new observation cases**. API typecheck, full API lint, production declaration build, focused formatting and `git diff --check` passed on the final source. These runs do not count generated declaration/build copies as additional source tests.

## Explicit limits

- All new provider evidence uses intercepted `fetch` with synthetic XML/streams and synthetic credentials. No real R2 objects, configuration, cleanup jobs or destructive calls were created or exercised.
- A listing above any observation cap is deliberately unavailable, not silently truncated. Operational cleanup must narrow its scope or use a separately reviewed cursor-based sweep before it can handle an inventory exceeding these limits.
- This does not repair existing creation/cleanup races, make provider operations reversible, prove full-file identity, establish durable browser recovery, or certify physical-device behavior.
- No database/schema/UI change is included. PostgreSQL integration, Web/PWA acceptance, owning CI, independent review, merge and deployment are separate gates; no acceptance is inferred from these source tests.

## Independent source review

Independent review of frozen preparation tree `e17c39dfffa7ae70be5426994d694e8a89d8107f` passed the full 100-file/493-case API source suite, API typecheck and 46 additional adversarial checks. Focused observation/shared-storage coverage passed 85 cases. Source hashes did not change during review. No blocking defect was found.

Two bounded caveats remain explicit. An oversized or invalid-UTF-8 HTTP error body can produce R2XmlError before shared SigV4 creates R2HttpError; existing status-dependent consumers use HEAD, whose behavior is unchanged, and observation callers remain sanitized and fail closed. The intentionally narrow parser does not accept every legal XML representation, including prefixed namespaces and standalone declarations. Current-provider response compatibility beyond the documented ordinary shape is not certified by synthetic fixtures.

The exact publication union still requires its own quality/integration/browser/security gates before merge and a separately verified deployment. No live-provider access was used for review.
