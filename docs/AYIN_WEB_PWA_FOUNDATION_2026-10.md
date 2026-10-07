# AYIN Web/PWA experience foundation — October 2026

## Scope and release boundary

This pass builds on verified release `20b8ef601310aa8deeaf97549de4588aca668299`, tree `510f42ec10e99bc53de6f86ef1b1ffc05d9cb689`. It improves the shared Web/PWA experience before the separate Clips viewing work. Existing product eligibility, ownership, media delivery, consent, protected writes, revenue and server configuration remain authoritative.

This document records a candidate until its exact source, owning CI and deployment are verified. Physical-device acceptance remains separate. It does not claim superiority to another video product or whole-site accessibility certification.

## Product decisions

- Keep AYIN's owned logo and dark/violet identity. Use opaque semantic action fills and text roles for legibility; gradients remain decorative.
- Keep server-configured primary navigation. Give current destinations a clearer surface/border; use measured mobile navigation height, larger readable labels and short-landscape layout instead of a fixed clearance estimate.
- Home's hero reaches its real actions sooner on small screens. Browse presents real eligible categories as readable linked panels. Search uses the shared compact PageHeader and clearer input/action boundaries. MediaCard exposes two title lines with complete accessible names and native title text.
- Keep ordinary document/form routes naturally scrollable. A global measured feedback dock reserves real document-tail space. Offline/reconnected notices and optional install/update feedback no longer independently compete with the mobile tabs.
- Upload aligns the actual upload, recovery and history consumers in one readable-width route; the added Studio link is distinct from the existing uncertain-upload recovery action.
- Studio promotes recent content and its primary management action while keeping live counters and secondary tools. Admin places its existing scoped search before workspace shortcuts/counters. Financial and security behavior is unchanged.
- No new font, icon package, UI library, animation dependency, media prefetch or cache policy.

## Shared presentation contracts

`design-tokens.css` preserves the existing palette and adds only consumed navigation/text roles and geometry/layer variables. Existing PageHeader defaults remain unchanged; `density="compact"` is used by Search and workspace overview consumers. Controls retain native semantics and the 44px AYIN product target.

`ViewportFeedback` is the sole global feedback owner. It combines the existing network banner and install/update controller without changing their state machines. ResizeObserver measures chrome/feedback instead of assuming English line height; window resize is the fallback. Observer/listener properties are removed on unmount. Feedback has bounded internal scrolling and native dialogs remain above it in the browser's top layer.

The geometry contract is deliberately small:

- `--ayin-shell-top`: actual sticky Viewer header height
- `--ayin-shell-bottom`: actual visible mobile-navigation height, zero on desktop/hidden navigation
- `--ayin-feedback-height` and `--ayin-feedback-space`: feedback height and real tail-scroll reservation
- `--ayin-visual-height`, `--ayin-visual-top`, `--ayin-visual-bottom`: usable VisualViewport bounds when not pinch-zooming, with layout-viewport fallback
- `--ayin-content-height`: conservative minimum content height; never a fixed-height form shell

Native NavigationDialog and ConfirmationDialog are bounded and centered within the visual viewport. Native focus trapping, Escape/remote Back, Cancel, busy-state and caller-owned mutations remain intact. The feedback dock clears the measured bottom bar or keyboard-sized viewport inset. Document scroll padding accounts for chrome and feedback; document-tail padding permits final links/controls to scroll above fixed notices.

Announcements remain in normal document flow and are never hidden for immersion. The next Clips stage must account for its actual route start/announcement/locale area when selecting its usable viewport; it must not assume the minimum content-height token alone gives a full media-stage rectangle. That stage owns its explicit compact/immersive consumer and history policy.

## Honest bootstrap recovery

A 15-second child-controller deadline bounds the complete navigation/identity/Home operation, including body decoding. The outer lifecycle controller remains available to distinguish an actionable deadline from a canceled/retired document. Timers and listeners are cleaned on every exit; sibling reads are aborted after early failures.

Only an actual identity `401` proves anonymous audience. Timeout, malformed identity, network and `5xx` responses remain errors with explicit localized retry. The identity parser's channel handle contract matches the server's Unicode/dot/underscore/hyphen support; profile/TV slug and entity-ID validation remain independently strict.

The existing three Home identity owners are retained. Local Home snapshots are bound to the Viewer bootstrap revision and matching account/profile lease. Suspension and owner change synchronously conceal private roots, abort stale work and require foreground authoritative revalidation. A delayed read cannot publish over a retry or a newer audience. Search provides an explicit recovery action as well.

## Verification protocol

The baseline is an immutable archive of the released tree. The comparison uses the same production build method, pinned Chromium, real disposable PostgreSQL/API/product fixtures, actual foreground pages, and the existing lab profiles:

- Desktop 1440×1000, normal CPU/network
- Constrained mobile 390×844, 4× CPU, 150ms latency, 200,000 B/s download and 96,000 B/s upload

Cold and warm cache samples are separate; Service Workers are blocked only in this controlled measurement, not in the real PWA gate. Route readiness, transferred static assets, requests, DOM and drawer actions are recorded. Measurements are laboratory observations, not production percentiles or physical-device performance.

Regression review triggers: both >10% and >50ms median timing increase, or both >5% and >5KiB additional transferred JS on an unchanged route. Any exception needs a concrete benefit and the matched evidence. Browser/measurement failures are retained and are not counted as passes.

Behavior coverage includes deadline headers/body, retries, blur/foreground and new owner, EN/AR navigation/reflow, prompt/navigation/dialog bounds and hit-testing, unchanged upload uncertainty flows, shared creator/admin workflows, account/search/hero ownership, native player regressions and real service-worker lifecycle/cache exclusions. Focused tests do not replace the required aggregate quality/browser/security/inventory gates.

## Remaining external gates

Installed iPhone/Android PWA, real virtual keyboards and safe-area/chrome behavior, VoiceOver/TalkBack, physical playback and store/provider acceptance require named device evidence. Synthetic visual-viewport tests exercise the layout contract only. No new provider, R2 settlement, CSP/access, native/store or commercial Ads approval is implied.

## Clips handoff

Reuse semantic tokens, measured chrome/feedback, native dialogs, compact heading mode and current Viewer lifecycle authority. Keep `useWatchProgress`, account/profile/Kids checks and existing media transport. Do not create a competing shell, progress store or authentication coordinator. Next-stage work is a separately accepted immersive viewport, one-player authority, bounded media residency and scoped panels/history; none is claimed implemented by this foundation pass.

Presentation rollback should revert this pass's UI/geometry consumers only and preserve all previously accepted authorization, media, dependency/security and backend behavior. The bootstrap deadline/identity contract is independently reviewable from visual changes.
