# Creator upload workflow review

Focused Phase6/12/13/14 candidate following #170 transport safety. Whole master phases0–16 remain open.

## Source findings and changes

The actual QuickUpload consumer performed unguarded blur autosaves alongside publish/thumbnail writes, trusted unchecked draft/processing/publication responses, could throw on malformed schedule values, displayed raw errors/English-only controls and navigated to unlocalized destinations. Identity failure silently disabled the picker. Processing read failures continued automatic polling indefinitely. Lost creation/publication responses allowed another mutation without resolving whether the original committed.

The shared Web/PWA upload now uses explicit Save details and a synchronous mutation guard across creation/transfer/save/thumbnail/publication. Controls freeze during each write; late acknowledgments after unmount are ignored and transport is canceled. Prepared roots must match the requested channel; processing and publication must identify the current video, with bounded known status/progress and safe slug contracts. API reads/writes have30s deadlines, with no automatic root/save/publication/completion replay. Thumbnail authorization/completion are validated, storage credentials omitted, and format/5MB bounds checked before authorizing.

Uncertain mutations retain the chosen file/known draft and pause further writes, with a locale-safe owned Studio review link. The client does not infer an unknown root from its title or pretend an aborted request rolled back. This is explicit recovery through Studio, not resumable arbitrary-device root recovery. Identity has a15s deadline and explicit retry. Processing stops on read failure/terminal jobs or30 reads and exposes a manual status check. Server processing remains authoritative; a read does not imply completion of an uncertain upload mutation.

The actual upload and shared advanced metadata fields use scoped EN/AR copy, locale-safe navigation and logical layout/focus. Custom format buttons support arrow/Home/End keyboard selection. Client checks cover title/schedule, tags/language/date/number bounds, territory shape/overlap, ordered bounded chapters/ad offsets and known video duration. Empty edited metadata is sent explicitly so removed tags/chapters do not silently retain older values. Backend country membership, all domain validation, ownership/Origin/rights/Kids and finance/audit remain authoritative.

Dirty uploads prompt before document unload or clicked-link departure. Browser history/programmatic transitions still require separate route-retention acceptance; they are not claimed solved. Partial-write atomicity in the backend details/advanced metadata/publish-rights sequence remains a separate security/data-integrity review, not fixed by a UI mutex. Large/provider/device processing, upload resumability, installed PWA/native upload lifecycles and whole Phase6/10/12/13/14 are not certified.

## Validation

Local319 Web units passed, including7 new contract/schedule/metadata/timeout/thumbnail cases; lint/types passed. Final lint, typecheck, targeted contract tests and production build passed after keyboard/acknowledgment cancellation refinements. Four browser journeys are authored against real registration/draft/save/publish/database state with explicit simulated HTTPS storage/processing completion: EN/AR held-save duplicate protection and genuine localized publication; committed root response loss without replay; committed publication with a foreign acknowledgment and retained review state. Exact-head CI, full browser execution and actual visual inspection remain pending. Simulated storage/processing do not establish real provider/device reliability.
