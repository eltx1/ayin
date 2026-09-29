# AYIN design system

## Authority and foundations

AYIN retains its dark/violet entertainment identity and canonical Web/PWA. Accepted foundations #143 and native data/form consumers #144 are the basis; reconciled playlist #145 remains a candidate until its final gates. Exact evidence is in [the checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md); detailed earlier design decisions remain in Git history and the linked implementation histories. Full Phase 4 and whole-product redesign are not complete.

`apps/web/src/styles/design-tokens.css` is imported once by globals and preserves the original palette, spacing, radii, surfaces, elevation, motion and safe areas. Migrated components use semantic text/action/control/status/type roles, logical CSS and natural wrapping. Use `--text-primary`, `--text-secondary`, `--text-muted`, opaque `--action-fill`/`--action-hover` and clear native focus. Brand gradients are decorative, not a substitute for text contrast. No new fonts, icon framework, animation package or UI dependency.

## One shared native component API

`components/ui/design-system.tsx` remains server-renderable and is imported within an existing client boundary only when its consumer needs events. It reuses the original `@ayin/ui` Button. `components/ui/data-presentation.tsx` owns tabular presentation and native disclosure/paging. Do not retain a parallel data-workspace FieldGroup/DataTable implementation.

**PageHeader:** explicit heading level, eyebrow/description/context/actions; no main landmark. Browse, directories, Studio and Admin retain actual route headings, shell ownership and locale links.

**ActionButton / ActionLink:** shared primary/secondary/quiet/danger styling. Native buttons default to non-submitting type, preserve caller attributes and genuinely disable while pending. Links remain real links; do not imitate disabled controls with active destinations. Consumers retain their protected mutation/confirmation logic.

**TextField / SelectField / TextAreaField:** explicit IDs and visible labels, joined helper/error descriptions and native required/min/max/disabled semantics. Validation is supplied by real server bounds, not invented by the primitive. Multiline fields retain native resizing. Errors do not automatically create repeated assertive live regions.

**FormSection:** native fieldset/legend with associated optional description and normal disabled propagation. Default stacked layout used by Support is unchanged. The playlist candidate adds `layout="inline"` for responsive wrapped fields/actions, collapsing on narrow screens. This is an optional presentation mode on the same native contract, not another form state system.

**StatusNotice / DataBadge:** truthful textual status plus tone. Only explicitly requested notices announce; ordinary badges are not live regions. Distinguish missing/failed/unavailable from real zero/empty. Never label configuration as observed provider availability.

**MetricList:** native definition list of real caller values. Zero, unavailable and optional provenance are distinct; no fabricated `0.00`. Existing Studio/Admin response meanings are preserved.

**DataTable:** generic rows/columns/stable rowKey; native caption, explicit column/row header scopes and local keyboard-scrollable region. Long values wrap without changing table roles. Comments uses its existing latest-100 snapshot; Playlists uses the owned collection. Candidate `scrollLabel` optionally differentiates the region's action label from its caption; defaults preserve Comments. Mobile overflow stays inside the table, not the document. Do not call local filtering global search or local paging backend pagination.

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

#144 passed exact-head full quality/security/browser/inventory and source/visual review. #145's original separate graph passed its own CI, not the new combined graph. Reconciled local Web tests pass 237/51 files with scoped lint/TypeScript/formatting. Browser journeys retain native semantics, real owned creation and isolation, uncertainty/duplicate guards, filtering/full traversal, EN/AR and screenshots. Local Node22/restored tooling does not replace CI Node24's frozen graph. Service-worker blocking is scoped only to intentional network-mocking tests; production/PWA is unchanged.

Selected historical build-asset measurements and their increases remain in `PERFORMANCE_BASELINE_AND_RESULTS.md`; no CWV/latency/player/upload/full-transfer improvement is claimed. Combined CSS/browser behavior must be tested after consolidation, not inferred from the two separate green candidates.

Remaining Phase 4: accessible tabs/segmented controls with genuine consumers, contextual content editors, confirmation/dialog/drawer generalization, lifecycle-safe notifications and missing domain-card variants. Whole Viewer/Creator/Admin redesign, dense finance forms, full localization/large-data visual acceptance, installed PWA and native/store readiness remain later master phases. New primitives require real consumers, not a public developer showcase. Keep server safeguards and adopted fast-uri fixes on presentation rollback.
