# AYIN design system

## Authority and foundations

AYIN retains its dark/violet entertainment identity and canonical Web/PWA. Accepted foundations #143 and native data/form consumers #144 are the basis; reconciled playlist #145 is accepted/deployed. Exact evidence is in [the checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md); detailed earlier design decisions remain in Git history and the linked implementation histories. Full Phase 4 and whole-product redesign are not complete.

`apps/web/src/styles/design-tokens.css` is imported once by globals and preserves the original palette, spacing, radii, surfaces, elevation, motion and safe areas. Migrated components use semantic text/action/control/status/type roles, logical CSS and natural wrapping. Use `--text-primary`, `--text-secondary`, `--text-muted`, opaque `--action-fill`/`--action-hover` and clear native focus. Brand gradients are decorative, not a substitute for text contrast. No new fonts, icon framework, animation package or UI dependency.

## One shared native component API

`components/ui/design-system.tsx` remains server-renderable and is imported within an existing client boundary only when its consumer needs events. It reuses the original `@ayin/ui` Button. `components/ui/data-presentation.tsx` owns tabular presentation and native disclosure/paging. Do not retain a parallel data-workspace FieldGroup/DataTable implementation.

**PageHeader:** explicit heading level, eyebrow/description/context/actions; no main landmark. Browse, directories, Studio and Admin retain actual route headings, shell ownership and locale links.

**ActionButton / ActionLink:** shared primary/secondary/quiet/danger styling. Native buttons default to non-submitting type, preserve caller attributes and genuinely disable while pending. Links remain real links; do not imitate disabled controls with active destinations. Consumers retain their protected mutation/confirmation logic.

**TextField / SelectField / TextAreaField:** explicit IDs and visible labels, joined helper/error descriptions and native required/min/max/disabled semantics. Validation is supplied by real server bounds, not invented by the primitive. Multiline fields retain native resizing. Errors do not automatically create repeated assertive live regions.

**FormSection:** native fieldset/legend with associated optional description and normal disabled propagation. Default stacked layout used by Support is unchanged. The accepted playlist implementation adds `layout="inline"` for responsive wrapped fields/actions, collapsing on narrow screens. This is an optional presentation mode on the same native contract, not another form state system.

**StatusNotice / DataBadge:** truthful textual status plus tone. Only explicitly requested notices announce; ordinary badges are not live regions. Distinguish missing/failed/unavailable from real zero/empty. Never label configuration as observed provider availability.

**MetricList:** native definition list of real caller values. Zero, unavailable and optional provenance are distinct; no fabricated `0.00`. Existing Studio/Admin response meanings are preserved.

**DataTable:** generic rows/columns/stable rowKey; native caption, explicit column/row header scopes and local keyboard-scrollable region. Long values wrap without changing table roles. Comments uses its existing latest-100 snapshot; Playlists uses the owned collection. Optional `scrollLabel` differentiates the region's action label from its caption; defaults preserve Comments. Mobile overflow stays inside the table, not the document. Do not call local filtering global search or local paging backend pagination.

**Disclosure:** native details/summary with optional content; no mirrored aria-expanded state or external library. Adopted for optional ticket priority/history and long comments. Data already in a bounded response is not claimed as lazy API loading.

**PageControls:** named native Previous/Next actions, real disabled edges and polite page summary. Caller owns page state; controls neither fetch nor fabricate rows. Playlist filtering resets/clamps page state and reaches all returned records.

**MediaCard / MediaArtwork:** server-rendered title/link/focus/aspect ratio and lazy image leaf. Source-keyed failure reveals a stable decorative fallback without another request, fake artwork or blocked link. Preserve poster/landscape layout and RTL insets.

**Existing shared systems:** keep Viewer states/skeletons, native modal/remote focus, breadcrumbs, Hero/rails and logical ad slots. Decorative loading is not accessible fake content. This phase does not replace real provider/player/upload behavior.

## Real consumer adoption and recovery

Comments and Support (#144) actually use these primitives. Comments retains full available text and recent-snapshot filters. Support keeps its ordinary short form, optional priority, protected ownership and input bounds. Acknowledged POST remains success even if follow-up GET fails. Failed/uncertain writes retain drafts and are not automatically replayed. The uncached read helper cancels stale/unmounted requests and distinguishes loading/ready/error.

Reconciled playlist #145 adopts the same FormSection/DataTable plus PageControls in both Studio and standalone entrypoints. Synchronous duplicate guards, disabled pending fields, optional abortable reads, truthful collection counts, private-preview exclusion and protected Uploads behavior survive migration. Invalid response arrays are errors, not a successful empty collection. Both feedback and playlist translations/tests remain; typed collision tests prevent one from silently overwriting the other.

## Accessibility and measured boundaries

Opaque migrated text/action/status pairs are contrast-tested at 4.5:1 for ordinary text; controls/focus at 3:1. Tests do not round a failure upward or certify text on photographs/legacy gradients. AYIN chooses 44px controls; the WCAG 2.2 AA target-size minimum is 24px with defined exceptions, not 44px. Reduced-motion rules disable new busy animation; forced colors preserve outlines/borders. Native headings, labels, main ownership, keyboard and local scrolling are tested rather than replaced by div-based simulations.

Previously checked official sources (2026-09-29):

- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- https://www.w3.org/WAI/tutorials/forms/grouping/
- https://www.w3.org/WAI/tutorials/tables/one-header/
- https://www.w3.org/WAI/tutorials/tables/caption-summary/
- https://www.w3.org/WAI/ARIA/apg/patterns/alert/
- https://react.dev/reference/react-dom/components/img

## Tests, performance and remaining work

#144 and the final reconciled #145 passed exact-head full quality/security/browser/inventory and source/visual review; both are merged/deployed. Their historical separate candidates are not the current acceptance graph. The #145 reconciled local Web suite passed 237/51 files with scoped lint/TypeScript/formatting. Browser journeys retain native semantics, real owned creation and isolation, uncertainty/duplicate guards, filtering/full traversal, EN/AR and screenshots. Local Node22/restored tooling does not replace CI Node24's frozen graph. Service-worker blocking is scoped only to intentional network-mocking tests; production/PWA is unchanged.

Selected historical build-asset measurements and their increases remain in `PERFORMANCE_BASELINE_AND_RESULTS.md`; no CWV/latency/player/upload/full-transfer improvement is claimed. Combined #145 CSS/browser evidence is accepted; subsequent component changes need their own exact-head gates.

Remaining Phase 4: additional segmented controls where justified, confirmation/dialog/drawer generalization, social-action failure feedback and missing domain-card variants. The real focused content editor and manual-activation tabs are reviewed below. Whole Viewer/Creator/Admin redesign, dense finance forms, full localization/large-data visual acceptance, installed PWA and native/store readiness remain later master phases. New primitives require real consumers, not a public developer showcase. Keep server safeguards and adopted fast-uri fixes on presentation rollback.

## Phase 4C reviewed implementation — focused content editing

`EditorTabs` is a reusable manual-activation tablist with linked native-button/tab-panel semantics, one active stop, arrows/Home/End focus and Enter/Space activation. Physical arrows reverse in RTL. Inactive panels stay mounted and hidden to retain advanced inputs and selected caption files; no ad-hoc stateful form library. The real `/studio/content` editor uses it with existing FormSection, fields, buttons, DataTable and notices, not a developer showcase.

The library opens one editor instead of rendering every possible field for every video. Read limits remain truthful. Synchronous pending and caption coordination prevent duplicate actions/leaving mid-operation; acknowledged mutations and failed refresh are distinct. The existing backend two-stage PATCH is explicitly not atomic. Failed/unconfirmed writes retain the draft and block blind replay. Document unload, explicit close and ordinary same-tab links warn on draft loss; browser same-document Back/Forward and legacy advanced/caption text remain separate follow-ups.

The editor dictionary uses existing locale/context/interpolation through a route-scoped helper. Measured global-dictionary overhead was removed. Final Home/Browse selected entry JS remains unchanged; the separate shared breadcrumb improvement adds 17 selected gzip bytes to Admin, as recorded in the performance report. See [Phase 4C evidence](AYIN_PHASE4C_EVIDENCE.md) for the W3C APG source, actual local/CI tests and build metrics, with remaining release gates. This is not whole-design-system acceptance.

Final reviewed source2ebc0c1 passed all exact-head quality/security/browser/inventory gates and author-side review5356461735. Actual image review found a mobile Arabic tab clipped despite no document overflow. Mobile tabs now wrap labels without changing manual activation; tests assert the tablist and each button/text bounds plus44px minimum targets. A selected video owns one h1, and breadcrumbs omit identical translated group/page labels while preserving distinct groups and actual localized links. Final four new images were inspected from verified artifact11052800099. A settled, viewport-contained disabled-action capture confirms readable text; no speculative opacity/style workaround was introduced. Local250 tests/54files and build passed. Final docs/merge/deployment remain explicitly separate in the checkpoint.

## Accepted Phase4D — native decision dialogs

`ConfirmationDialog` is a client decision-only leaf using native dialog, existing ActionButton and AYIN tokens. Closed instances render nothing. Open instances label their title/description, initially focus Cancel, wrap Tab at boundaries, cancel on Escape/focused-modal remote Back and settle once. The consumer must close the dialog and owns any mutation; the component never retries or changes permissions. Busy native actions cannot submit. Cancellation restores a visible connected origin; accepted actions hand focus/navigation to the consumer.

`dialog-focus.ts` is shared with NavigationDialog and excludes disabled/hidden/inert/negative-tabindex controls. A focused confirmation above navigation consumes remote Back first. Actual adoption is Studio content discard, same-tab link departure, remove and unpublish. Existing pending/caption/uncertain-state/server guards remain. Route-local EN/AR labels avoid global dictionary inflation. Native beforeunload is retained, but same-document history and mobile delivery limitations are not falsely certified.

Local264 Web tests and production/type/lint/format checks passed. Final quality36646275205, security36646275139, browser36646275094 and inventory36646275114 passed; reviewed visuals and production deployment are recorded in the master checkpoint and #148 release record. See [Phase4D evidence](AYIN_PHASE4D_EVIDENCE.md). This is not complete Phase4 or global Admin/PWA/device acceptance.

## Accepted Phase4E — duplicate-safe TV focus identities

TV focus attributes remain semantic hints and are no longer assumed globally unique. `TvFocusScope` derives occurrence-aware navigation IDs before geometric ranking, preventing a repeated media/card identity from causing the first DOM occurrence to masquerade as the current target. Persistence uses the same occurrence-aware identity only when necessary; legacy raw values still resolve, and a saved duplicate occurrence can fall back to its semantic target if later data renders one copy.

The fix is systemic rather than page-specific. Cards, navigation, dialogs and future focusable surfaces do not need synthetic per-page IDs merely to satisfy geometry. Unnamed elements remain local automatic targets and are not persisted. Modal scope containment from Phase4D is unchanged. Pure tests and real browser geometry regression passed; merge/deployment evidence is in the master checkpoint.

## Accepted Phase4F — lifecycle-safe Notifications and network feedback

The real Viewer Notifications route now adopts PageHeader, ActionButton, StatusNotice and Viewer empty/error states instead of inline/raw presentation. Notification API payloads are parsed as bounded client contracts; malformed data is an error, not a successful empty inbox. Existing server cursor pagination is exposed with deduplicated continuation.

Mark-read follows the same uncertainty principle used in creator writes: an unconfirmed PATCH is never blindly replayed. The affected row becomes uncertain and disabled until an explicit refresh reconciles server truth. Existing account ownership and 401 routing stay server-authoritative. Notification action buttons participate in the shared TV focus model.

The global NetworkStatusBanner now distinguishes offline from reconnected. Offline is assertive, recovery is polite and temporary, and mobile placement remains above the fixed bottom navigation. Both states are localized EN/AR. This improves lifecycle feedback but does not claim installed-PWA/offline-content completeness.

The phase also updates newly vulnerable framework dependencies without lowering audit policy: Next 16.3.6, Nest 12.0.3 and a single pnpm-workspace-pinned Fastify 5.12.5 graph. Exact source/security/browser/visual and deployment evidence belongs in the checkpoint. Social Like/Subscribe failure handling remains a separate focused follow-up rather than being hidden inside this Notifications change.

## Phase4G candidate — recoverable social actions

Viewer social controls now follow the same uncertainty rule as Notifications and creator writes. Subscribe, Like, Not-for-me, Watch Later and My List do not optimistically invent committed server state after a failed/lost response. Initial state reads validate complete response contracts. Unconfirmed writes retain the last confirmed view, expose a warning and require an explicit read refresh before another mutation. Share cancellation is excluded because it is not a server write.

The implementation keeps existing login gates, profile isolation, analytics event boundaries and social API routes. Response parsers accept only non-negative integer counts, known reaction values, boolean saved flags and matching saved-list acknowledgements. Route-scoped EN/AR copy avoids growing unrelated bundles. Retry/refresh actions and social controls remain in the shared TV focus model.

Exact source/security/browser evidence is recorded in the checkpoint. Reviewed visuals show clear desktop subscription state and contained Arabic mobile action labels. This is not the whole Viewer redesign, a claim of social-provider delivery, or a performance improvement. Phase5 still needs the raw Community surface, consumer-friendly Kids copy and the remaining Viewer route families.
