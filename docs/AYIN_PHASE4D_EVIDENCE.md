# Phase4D confirmation and editor decision evidence

## Scope

Start from accepted/deployed main `d3484c6ec4d256effb9f440b882428a42ce0aea7`. This focused subphase creates a native shared decision dialog with real Studio editor adoption, not a public showcase or a new mutation/security system. Exact head, gates and release are recorded in the master checkpoint.

## Engineering decisions

Use the existing AYIN tokens and ActionButton. A ConfirmationDialog has a labelled native dialog/title/description, Cancel-first initial focus, normal Tab order with edge wrapping, Escape and focused-modal remote Back cancellation. Synchronous settlement permits one decision. Busy actions use native disabled semantics. Cancellation returns focus to a connected, visible origin; accepted navigation/mutation gives control to its consumer. The component never owns a network call, retries a write or adds a second MFA implementation.

NavigationDialog shares the tab helper instead of maintaining divergent selectors. Hidden, negative-tabindex, disabled (including disabled fieldsets) and inert controls are not targets. Native dialogs supply top-layer modality; TV geometric scope already stays inside the modal. Remote Back is consumed only by the modal containing focus, so an underlying workspace menu cannot cancel itself ahead of a confirmation. No overlay click implicitly confirms or discards a draft.

StudioVideoEditor captures one explicit decision for close, ordinary same-tab link, remove or unpublish. Pending metadata/caption operations do not open a new decision or leave. Dirty fields/file selections survive cancellation. Confirmed removal/unpublish still invokes the existing ownership/Origin-protected JSON action exactly once. Uncertain or partial metadata changes remain read-only until the existing read-only review flow; two-stage PATCH is not made atomic by a modal.

The native beforeunload warning remains for full-document departure. Same-document history Back/Forward is explicitly not covered; do not claim it is. Modified clicks, download links, new windows and same-document hash links are not replayed. Same-origin accepted navigation uses the existing router; cross-origin document departure retains the native unload warning with no bypass allowance. No draft is copied to persistent storage or exposed to another account.

## Tests and measurement boundaries

Five new local cases verify closed/no-action rendering, native labels/actions/order, escaped actual content, Arabic/pending state, complete route vocabulary and pure wrapping boundaries. Full Web result264/264 in56files; full Web lint/relevant formatting and both production builds passed. Local restored compatible tooling/Node22 is not a fresh CI Node24 frozen API/security installation. React server markup does not prove modal focus; actual browser assertions are required.

The content browser suite retains four previous real API journeys and adds one. New checks include Cancel focus, Shift+Tab/Tab, Escape/trigger restoration, Arabic dialog and text bounds,44px controls, nested navigation/confirmation remote Back, actual draft retention, double-confirm-single-mutation and confirmed navigation with zero hidden writes. Existing other-account404, foreign-Origin403, real unpublish state and actual caption finalization/deletion remain. Fixtures fail closed outside local ayin_e2e; service-worker blocking stays limited to this already intentionally intercepted suite. Full browser execution and new screenshots are not yet observed on this candidate.

Selected route-entry gzip comparison uses each route's Next client-reference manifest, deduplicates entryJSFiles/entryCSSFiles, gzips each file at level9 and sums. Both builds used the same local environment/dependency layout. Content JS49968→50986; Studio40567→40700; Admin45985→46120; Browse43929→44064; Home50347→50482. CSS Content/Studio17000→17157, Admin11642→11799, Browse21222→21379, Home14351 unchanged. These are not whole-browser transfer, field CWV or backend/player/upload timing. No speedup claim.

## Official documentation checked

Checked September30,2026 Cairo (workflow timestamps use UTC). W3C modal guidance supports contained focus, labelled dialogs, sensible cancellation focus and return focus. MDN explains native showModal top-layer/inert behavior and beforeunload limitations. These sources do not certify a physical television or promise reliable mobile unload delivery.

- W3C ARIA APG, Dialog (Modal) Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- MDN HTMLDialogElement.showModal(): https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal
- MDN Window.beforeunload: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event

## Remaining acceptance

Exact-head CI and actual screenshot/source review precede merge. Full browser-history draft recovery, long-list scroll state, deeper captions, broad Admin confirmation/uncertain-write adoption, native devices and whole-product accessibility/PWA/performance/security remain later evidence. No schema, permissions, finance, provider, ad delivery, dependency or signing changes. Preserve prior security/locale/request fixes when separately reverting presentation.
