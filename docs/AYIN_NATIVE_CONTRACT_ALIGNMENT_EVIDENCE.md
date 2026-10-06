# AYIN native progress and Android video-selection alignment

Prepared 2026-10-06 on local base `43fa32a7`. This is a source candidate, not device, store or production acceptance.

## iOS: conditional progress without changing native playback

The Web/API progress contract now returns a nullable revision and supports an `expectedRevision` compare-and-write. The API deliberately preserves old callers' unconditional writes. The old Swift client did not decode or send that revision: an iPhone checkpoint based on R0 could overwrite another client's R1 progress.

The native service now requires an explicit revision field, verifies video/profile response identity, returns the acknowledged revision and always encodes `expectedRevision`. A first write uses an explicit JSON null; omitting the key would invoke the legacy path. The API and compatibility behavior are unchanged.

`ProgressRevisionState` accepts one current read or write ticket. A conflict, lost acknowledgment, malformed response or failed baseline read pauses persistence and exposes a native “Review saved progress” action. Reviewing performs a read only. It does not replay the uncertain checkpoint or seek backwards; subsequent advancing checkpoints use the reviewed revision. A later save cannot reduce the authoritative position established by that read.

Mounted native playback now treats bearer-token/profile changes as a new scope. It cancels the old progress work without a final old-scope save, resets generation/tickets, and prevents late reads, acknowledgments or checkpoint workers from adopting or clearing a replacement scope. Normal close retains its existing final checkpoint. AVPlayer, audio interruption handling, HLS/MP4 fallback, Keychain login, PiP/AirPlay, existing native discovery and API ownership remain the established architecture.

Independent source review also identified asynchronous work outside the progress ticket: a retry could finish its old final checkpoint and reload a superseded identity, and already-enqueued AVPlayer observer Tasks could act on a replacement item or emit completion after an identity change. Cleanup now reports whether it still owns its generation; retry stops when superseded. Observer work binds to the originating player, item and generation, including checks after awaited completion/fallback work. Three additional model-level regression tests use local silent media and controlled checkpoint acknowledgments to cover superseded retry, late completion and duplicate old-item failure during MP4 fallback. These tests are authored but not locally executed.

New XCTest assertions cover explicit-null first writes, revision handoff, missing/malformed/foreign baselines, one pending checkpoint, conflict/unknown acknowledgment requiring review, no backwards replay and old-scope read/write rejection. Existing service transport assertions were updated to the actual current API response.

## Android: one permission-free video document selection

The shared creator upload route already has a real file input, but the native `WebChromeClient` had no file-selection callback. The shell now launches the system document picker for one accepted video file using the existing Activity Result API. It requests no camera or broad storage permission and does not persist a document grant. Existing Web/API file-size and upload validation remain authoritative.

The returned URI must be a readable `content:` document with a video MIME type accepted by the requesting input. Single-result clip data is supported; multiple results, non-video data, unsupported requests, capture mode and unavailable pickers resolve as cancellation. This narrowly enables the video inputs used by Quick Upload, Direct Video Uploader and the MP4-only Admin import. Image, caption and CSV inputs are not silently claimed supported by this video-only change.

A selection owns the initiating WebView/document and callback. Navigation (including same-document history), a replacement renderer or Activity teardown cancels that callback exactly once. Its system-result slot stays occupied until the old result arrives, so a late A result cannot satisfy a new B request. Renderer-origin bridge messages are also checked against the current WebView. No native request uploads anything on its own; user selection resumes the existing Web form.

Independent review found that MIME/readability validation originally made synchronous provider calls on the main thread. That work now runs on the IO dispatcher under the existing Activity lifecycle scope. The lease stays owned throughout validation; delivery returns to the main thread and rechecks both lease and document identity. Navigation cancels pending validation, and its late result cannot deliver to or release a replacement callback. An additional JVM regression covers cancellation while provider validation is pending. No new dependency, permission or persistent URI grant was added. Slow-provider responsiveness and interrupted picker flows remain emulator/device checks.

New JVM assertions cover MIME narrowing, rejection, duplicate requests, cancellation, late results and release of a failed launch slot.

Official references checked for this implementation:

- [WebChromeClient.onShowFileChooser](<https://developer.android.com/reference/android/webkit/WebChromeClient#onShowFileChooser(android.webkit.WebView,%20android.webkit.ValueCallback%3Candroid.net.Uri%5B%5D%3E,%20android.webkit.WebChromeClient.FileChooserParams)>): the application owns the file request/callback and must validate the result.
- [Activity Result APIs](https://developer.android.com/training/basics/intents/result): registration is unconditional in the Activity's construction path; the result callback is lifecycle-aware.

## Validation and remaining gates

Performed locally: source/contract inspection; `git diff --check`; every one of the 74 documented route patterns resolves to its inspected source; platform plist/entitlement/status files parse. These checks are not Swift/Kotlin compilation or test execution.

This executor has Java but no `swift`, `xcodebuild`, `gradle` or `kotlinc` on PATH. No SDK/toolchain installation, emulator launch or substitute simulated native pass was performed.

Existing supported CI paths require no new credentials or workflow changes:

- `.github/workflows/ios-app.yml` triggers on `platforms/ios/**`, uses `macos-15`, generates the project with XcodeGen, builds with `CODE_SIGNING_ALLOWED=NO`, and runs all `AYINTests` on an iPhone simulator. `project.yml` includes the new Swift and test files by directory.
- `.github/workflows/android-shell.yml` triggers on `platforms/android/**`, builds mobile/TV/Fire debug flavors, runs all three JVM suites and lint, and retains its separate Android/Google TV/Fire APK emulator baseline. The new source/test files are in those ordinary source sets.

Required before source acceptance: independent review and the owning native CI on the exact final candidate. The native progress review UI and actual document-picker flow still need emulator/device observation; pure state tests alone do not prove their rendering or OS behavior. Existing iOS simulator evidence and Android historical emulator evidence are not repurposed as this candidate's result.

Still separate: physical devices, actual file-provider variations, OS background/restore, release signing, App Links/AASA with real release identities, store agreements/submission/approval, native IMA/provider acceptance and complete native Arabic/feature parity. This candidate neither activates a provider nor changes permissions, credentials, signing or financial records.
