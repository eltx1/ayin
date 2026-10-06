# Dormant browser upload recovery

The existing `/upload` Web/PWA workspace now contains an optional recovery disclosure beside Quick Upload and upload history. Quick Upload keeps the existing V1 transport. Selecting recoverable upload never falls back to the legacy draft endpoint. Every shipped server still binds `DURABLE_UPLOAD_SETTLEMENT` to `UnsupportedDurableUploadSettlement`, so new recovery admission is visibly unavailable in production. The authenticated capability response is advisory; every server write rechecks its own authority, revision, expiry and settlement conditions.

## Explicit flow

1. Choose **Check saved upload** to read availability, any saved device descriptor and its current server outcome.
2. Select a video and check every byte in a dedicated Web Worker. The shared `AYIN_SHA256_CHUNKS_V1` implementation uses fixed 4 MiB chunks and the canonical bounded manifest. The producer reads only one bounded Blob slice at a time. File bytes never travel to the AYIN API for identity checking.
3. Explicitly create a recoverable draft. Save an account/profile/channel-scoped request marker before sending the request. No draft is created by selecting a file.
4. After reopening, select the exact original file and choose **Continue upload**. It recomputes the complete identity when selected and resumes only after the server verifies that identity.
5. One Continue intent owns one controller/latch and sends missing parts sequentially, bounded by the captured part count. Each part uses a fresh request UUID/current authority and revision; its grant exists only in that invocation and permits one PUT. After each acknowledged PUT, a read must confirm that exact part and increasing observed bytes. Missing, unavailable or regressed observations stop the intent; the client never automatically resends a part. Progress reflects observed bytes and Stop aborts local work. Session/part diagnostics and provider cleanup detail sit in an optional disclosure.
6. Explicitly complete when all parts or the stored object have been observed. Acceptance means queued integrity verification and processing, never publication or verified playback readiness. Continue in existing Studio/content/history.
7. Explicit cancellation stops future platform grants and records durable cleanup debt. The UI says existing provider links may remain usable and cleanup settlement is pending. It never claims deletion or provider revocation.

This is a deliberately bounded recovery surface: one locally retained recovery session and one operation at a time. It does not add background transfers, a second processing queue, offline command replay or file-system permission prompts. After a verified completed or cancelled outcome, creators may remove the device descriptor to prepare another upload; this only removes local metadata.

## Persistence and authority

`ayin.upload-recovery.v1` contains only an allowlisted version, initiating account/profile/channel IDs, creation UUID, safe session DTO and pending command kind/request UUID. Its serialized size is capped at 8 KiB. Files, Blobs, filenames, digests, full request bodies, provider object/upload identifiers, ETags, bearer tokens, cookies and presigned URLs are never written to localStorage or sessionStorage. The descriptor grants no authority.

All API requests use credentials and no-store; response streams have explicit byte and time bounds. The client rechecks `/auth/me` before and after operations. It obtains the current login ID from the existing `/auth/sessions` read and sends existing expected-account/session headers to fence a cookie change between a read and a write. Account, profile, ownership or login failures clear active state and the local descriptor. Another scoped identity cannot load the saved record. Logout or a new login is never inferred from cached metadata.

Page hiding, backgrounding, unmounting and another tab's descriptor change abort local work, terminate hashing, release file references and hide displayed private details. Recovery also subscribes to the existing viewer coordinator's before-suspend boundary and native private-identity concealment marker; verified account/profile changes discard the old scoped device marker. Unverifiable identity hides facts and preserves safe pending metadata for a later verified read. The initial account/session pair and final identity read are both account-fenced. A suspended page does not restart work on return. The user must re-read current authority and select the file again. Aborting a local request does not claim the server or provider stopped: its persisted marker remains inspectable.

## Lost responses and uncertainty

No POST or provider PUT is retried automatically or replayed by this client. The pending marker is written before dispatch. A lost CREATE response is recovered with `GET /creator/videos/recoverable-drafts/:requestId`; a pending session command is read through `GET /media/uploads/sessions/:sessionId/operations/:requestId`. Even a saved terminal state is rechecked server-side before being presented as a verified result.

PENDING and UNKNOWN keep further grants/completion disabled. Read-only inspection does not repair, reissue, extend or settle anything. A 404 is inconclusive and never permission to resend or create a replacement. A successful duplicate authorization does not contain a grant and cannot issue a PUT. Once a read confirms the old outcome, the creator must explicitly request any new authorization with a fresh UUID. Cancel remains available when the session is known and unresolved.

Full-file identity mismatch is an explicit server rejection: the creator may select the original file and inspect/resume again. Client metadata and provider HEAD/part observations never establish full-byte integrity. The existing server worker remains the integrity and canonical-output authority.

## Verification

Focused Vitest tests cover frozen identity vectors (short, exact chunk, multiple chunks plus tail), bounded reads, empty files, middle-byte substitution, cancellation and stale worker messages, malformed/cross-account responses, persistence allowlisting and failures, login/profile changes, lost commands, 404/UNKNOWN, duplicate authorization without a grant, and local finished-descriptor removal.

`pnpm test:e2e:recovery` runs the dedicated Playwright configuration against real Nest endpoints and isolated PostgreSQL `ayin_e2e`. The API test harness overrides the settlement/storage providers through test-only DI and uses an independent loopback synthetic provider receiving actual fixture bytes. Production modules never import the harness and no environment/configuration flag enables production recovery. Browser tests cover worker-based multipart reload/reselection, wrong original file, lost CREATE and AUTHORIZE responses, UNKNOWN cancellation, session change, blocked localStorage and English/Arabic mobile layouts. CI runs these separately from ordinary V1 and PWA acceptance.

Real provider browser-grant and server-write settlement evidence, cleanup verification, provider credentials/configuration and production admission remain external gates. This browser slice supplies none of them and performs no publication or provider activation.
