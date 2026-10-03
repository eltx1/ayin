# Creator upload transport review

Focused Phase6/10/14 candidate; the complete upload interface/master is unfinished.

## Actual source findings

The direct upload path cast sessions, resumed parts and completion acknowledgments without validation. It could send bytes to an insecure URL, trust duplicate/wrong-sized resumed parts, report100 for a different acknowledged asset, retry rejected authorization requests and keep background work/timers after cancellation. Thumbnail metadata could wait indefinitely; failed later frames leaked earlier preview URLs; tall portrait videos produced unbounded canvas height. QuickUpload could accept late preview choices after file replacement/unmount.

## Correction scope

Validate/sanitize actual single/multipart session contracts, UUID/token/part count and exact file segmentation; accept HTTPS storage or the exact configured loopback API origin for HTTP. Validate bounded unique resumed parts and their actual expected sizes; verify matching UPLOADED completion before reporting100. Storage PUTs explicitly omit browser credentials. Reject malformed protocol and nonretryable authorization4xx without repeating them. Preserve bounded retry/backoff for transient idempotent byte PUT/part authorization; completion/root writes are not automatically replayed.

Optional AbortSignal cancels API requests, active PUT and retry waits; cleanup removes listeners/timers even after synchronous XHR setup failure. API responses have a30s deadline. A timed-out completion remains uncertain; this transport does not pretend it was rolled back. Thumbnail steps are bounded to4s and canvas dimensions to1280 on both axes. Earlier partial previews and source URLs are released; the consumer aborts prior capture and rejects late delivery after selection changes/unmount.

The test-only E2e storage adapter now emits HTTPS fixture URLs, allowing the real browser consumer to exercise the production contract without permitting an insecure fake hostname in production code. Browser PUT routing is explicit simulated storage; source bytes are1024-byte test data and provider/device/real video processing certification is not claimed. Backend ownership, quotas, Origin/session transport, multipart integrity, rights/publish/audit and storage provider configuration remain authoritative and unchanged.

## Validation and remaining work

Final local Web validation passed all312 units across69 files, including17 transport/session/thumbnail cases, plus lint, typecheck and production build after the final capture-cancellation consumer wiring. Targeted cases cover real error branches, resource cleanup, wrong acknowledgments, forbidden storage origin, authorization denial and cancellation. Two new browser journeys use real registration/draft/upload completion with explicit storage simulation; one deliberately mutates an already committed completion response to a foreign asset and requires99/no confirmation/no replay. Exact-head full CI and browser execution remain pending.

Remaining QuickUpload issues are explicit: asynchronous blur autosaves can overlap publish/thumbnail changes; workflow-level synchronous guards, identity/read retry, retained draft/review recovery after uncertain root creation, local schedule/metadata validation, whole EN/AR shared form hierarchy/keyboard/visual coverage and navigation retention must be completed next. Existing processing polling and real source processing/provider reliability require separate measured acceptance. This PR does not claim to solve the whole upload workflow, installed-device uploads or whole Phase6/10/14.
