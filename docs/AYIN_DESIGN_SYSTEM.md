# AYIN design system

## Scope and authority

AYIN retains its existing dark/violet entertainment identity and canonical Web/PWA product. This document describes the **accepted Phase 4A foundation and the Phase 4B candidate**, not completion of every page redesign or the whole master goal. Read `AYIN_WEB_PWA_MASTER_CHECKPOINT.md` for exact phase, validation and deployment status. Existing Viewer, creator and Admin server permissions are unchanged.

## Audited foundations and decisions

The accepted palette, spacing, radii, surfaces, elevation, motion and safe areas lived in `apps/web/src/app/globals.css`. They are now in `apps/web/src/styles/design-tokens.css`, imported once by the global stylesheet. Every original base declaration is retained. New semantic roles give migrated components explicit text, action, control-boundary, status, typography and target-size choices without unexpectedly recoloring legacy pages.

Use `--text-primary`, `--text-secondary` and `--text-muted` for information, `--action-fill`/`--action-hover` for primary controls and the existing brand gradients for nonessential identity/decorative treatments. Small informative text must not depend on a multicolor background-clipped gradient. New action text uses an opaque contrast-tested pair; the legacy palette is not a license to put white text over every bright gradient stop.

The existing spacing scale remains authoritative; controls use `--radius-control`, sections `--radius-panel`, compact statuses `--radius-pill`. New typography roles distinguish page title, section title, body, secondary copy and labels. Components use logical layout properties, natural wrapping and `dir="auto"` for content where appropriate. There is no new font, icon framework, animation package or UI dependency.

## Reusable components and actual adoption

`components/ui/design-system.tsx` is compatible with server rendering; consumers that already need events import it from their existing client boundary. It reuses the existing `@ayin/ui` native Button instead of introducing another primitive foundation.

**PageHeader:** supports an explicit heading level, optional eyebrow/description/context and actions. It never creates a main landmark. Adopted on Browse, all four public directory families, Studio overview/playlists and Admin overview. Existing public route names, headings where asserted, locale paths and shell ownership are retained.

**ActionButton / ActionLink:** one control presentation with primary, secondary, quiet and dangerous button variants. Buttons default to non-submitting native `type="button"`, preserve caller attributes and become genuinely disabled/busy while pending. Links remain links rather than disabled-looking live controls. Adopted in directory recovery/continuation, Studio Quick Upload, creator playlist creation and Admin search. Consumers keep their existing authorization, confirmation and server mutation functions.

**TextField / SelectField:** explicit caller-provided IDs, associated visible labels, native required/length/select/disabled semantics, joined helper/error descriptions and explicit invalid state. They do not invent validation or submit mutations. Adopted in playlist Name/Visibility and Admin global search. Field errors do not automatically produce repeated assertive announcements; callers choose when a status needs announcing.

**StatusNotice / DataBadge:** visible status text accompanies tone; messages announce only when the caller requests polite/assertive behavior. Ordinary badges never become noisy live regions. Studio loading/failure and the Admin rollup label use them. They display observed/caller-supplied state and do not fabricate provider readiness.

**MetricList:** native definition list with real labels/values, tabular numbers and optional source detail. Zero and unavailable remain distinct; there is no automatic fake `0.00` fallback. Studio and Admin counters reuse their unchanged API values while removing their row of decorative statistic cards.

**MediaCard / MediaArtwork:** preserve existing card URLs, focus IDs, server-rendered titles, poster/landscape aspect ratios and lazy loading. A tiny client-only image leaf removes a failed image and reveals the existing decorative fallback without fetching a replacement asset, changing card dimensions or blocking its link. State is keyed by the actual source, not a permanent cross-card failure cache. Card metadata/badges gain readable type sizes; badge placement follows RTL logical insets.

**Existing View states and skeletons:** retain their public API and actual caller-provided title/copy/actions, normalize heading/control roles and preserve reduced-motion behavior. Decorative skeletons remain outside the accessibility tree. Existing modal/remote navigation, breadcrumbs, Hero, content rails and logical ad-slot runtimes are reused rather than replaced by untested parallel components.

## Accessibility and contrast acceptance

W3C WCAG 2.2 Understanding SC 1.4.3 requires at least 4.5:1 for ordinary text, with defined large-text exceptions. This foundation tests opaque migrated text/action/status pairs without rounding a failing value upward. Control boundary/focus tests use at least 3:1. These token tests do **not** certify arbitrary photograph overlays, legacy gradients or the entire product.

WCAG 2.2 SC 2.5.8 has a 24 CSS-pixel minimum with exceptions. AYIN deliberately uses a larger 44px minimum for these controls as a product choice; it is not a misstatement of the AA rule. The browser test measures an adopted creation control. Reduced-motion rules disable new busy motion; forced-color treatment preserves a visible outline/border. Native semantics, headings, labels, one-main ownership and focus remain testable rather than being replaced with div-based imitation controls.

Official sources checked on **2026-09-29**:

- W3C contrast: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- W3C target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- W3C alert pattern: https://www.w3.org/WAI/ARIA/apg/patterns/alert/
- React image events/loading: https://react.dev/reference/react-dom/components/img

## Testing, performance and remaining work

Unit tests render real primitives and cards, check labels/native constraints/zero metrics/message semantics, calculate token contrast, retain safe-area/palette compatibility and verify lazy decorative image markup. Browser scenarios use seeded real catalogs and authenticated creator/Admin workflows, intentionally fail an image then serve valid image bytes, compare artwork dimensions, check RTL/overflow/landmarks and preserve screenshots. Test fixtures never enable production flags or invent production content.

Historical local baseline Web suite: 190 tests; initial foundation suite: 201 tests. Accepted Phase 4A with locale regressions passed 216 local Web tests, and its final exact-head quality/security/browser/inventory gates passed as recorded in the checkpoint. The Phase 4B candidate currently passes 225 local Web tests; its full CI/browser acceptance is separate. Local Web type generation/typecheck, Web lint and production build have passed; exact frozen dependency, API/integration, security and real-browser acceptance belongs to final-head CI. Local Node is 22.16.0; CI is pinned to 24.19.0. The restored local tooling snapshot is not claimed as the accepted transitive production dependency graph.

Phase 4A intentionally does not create a public developer showcase route. All new primitives have a real product consumer. Full tables/filters/pagination grouping, tabs/segmented controls, contextual editor panels, form groups, modal/drawer/confirmation generalization, toast lifecycle and domain card variants remain subsequent Phase 4 work, with actual consumer journeys and focused PRs. No unimplemented item is considered complete. Phase 5–7 route-by-route design, finance form density and localization remain separate. Do not remove working backend capabilities for lacking new styling.

No new query, upload, ad/provider, native permission or security-policy behavior is introduced. Keep the adopted fast-uri patch on rollback; revert only presentation changes. Measure complete performance separately from limited build evidence and never equate a screenshot or token test with physical-device/store certification.

## Phase 4B candidate — native data and form consumers

**FormSection and TextAreaField:** extend the existing primitives without a new client foundation. Native fieldset/legend preserve grouping and disabled semantics; visible instructions are associated by ID, and multiline fields retain required/minimum/maximum length, native resizing, helper/error descriptions and caller accessibility attributes. Support uses these for the real ticket form; the optional priority is in a native disclosure rather than another mandatory step.

**Disclosure:** native details/summary preserve keyboard state without manually mirrored aria-expanded. Support uses it for additional options and ticket details; Comments uses it only for long text. It has no external library or unnecessary motion. Rendered hidden content remains part of the existing bounded response, not a claim of lazy API loading.

**DataTable:** real table/caption with explicit column and row header scopes, stable internal row keys, logical alignment and a named focusable local scroll region. Comments is the actual first consumer, not a demo route. Data is the existing private latest-100 snapshot; filters never masquerade as global server search. Mobile horizontal scrolling remains local to the table while the document fits its viewport. Column layouts preserve native table semantics rather than breaking them with grid roles or display tricks.

**Read and write states:** the uncached read helper distinguishes loading, successful empty, populated and failed responses and suppresses superseded results. It is not an identity manager or an automatic mutation retry system. Support shows an acknowledged send separately from a failed list refresh, disables pending fields, preserves drafts on failures and warns when the write outcome is uncertain. No server policy is relaxed and no consumer-facing Admin diagnostic copy is introduced.

Current official sources for this subphase, checked 2026-09-29:

- https://www.w3.org/WAI/tutorials/forms/grouping/
- https://www.w3.org/WAI/tutorials/tables/two-headers/
- https://www.w3.org/WAI/tutorials/tables/caption-summary/
- https://playwright.dev/docs/network#missing-network-events-and-service-workers

The native component/unit checks are not complete browser or physical-device certification. Actual generated screenshots, role/ownership and error/write journeys must pass before subphase acceptance. Shared tabs/segmented controls, full pagination and filtered server query workflows, modal/confirmation/editor generalization, toast lifecycle and complete domain-card adoption remain subsequent work; no unused fake showcase is added to claim coverage.
