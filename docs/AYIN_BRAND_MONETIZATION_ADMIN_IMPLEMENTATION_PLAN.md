# AYIN Brand, Creator Monetization & Admin Control Center Implementation Plan

Status: Active implementation plan
Scope owner: AYIN / Horus Media
Branch: `feature/brand-monetization-admin-control-center`

## 1. Goal

Upgrade AYIN in three coordinated areas without changing the current media-delivery architecture:

1. Make the approved AYIN logo and its luminous violet/magenta/coral/orange palette the visual identity of the entire product.
2. Turn Creator Studio monetization from a basic ledger view into a practical creator financial center.
3. Turn Admin from a set of operational pages into a cohesive, safe platform control center.

This plan is additive to `AYIN_MASTER_PLAN.md` and follows `AYIN_AI_AGENT_RULES.md`.

## 2. Hard constraints / non-goals

- **Cloudflare media architecture is frozen for this work.** Keep creator video storage on Cloudflare R2 exactly as it exists now.
- Do not add Cloudflare Workers, Stream, transcoding, HLS conversion, SSAI/DAI infrastructure, or a new media pipeline.
- Do not proxy creator video bytes through the application server.
- V1 remains playback-ready MP4 with direct client-to-R2 upload.
- Do not make future payout providers appear connected when they are not.
- Manual payout is the first operational provider; PayPal/Payoneer/Wise/bank-provider integrations remain adapters for later connection.
- Do not store card data. Sensitive payout destination data must never be returned to the browser in plaintext after save.
- Preserve global/non-country-specific product language and responsive/TV accessibility.

## 3. Workstream A — AYIN visual identity system

### A1. Official brand asset

Use the approved uploaded AYIN artwork as the source logo. Store an exact web-ready copy under `apps/web/public/brand/` and use it in viewer, Studio and Admin shells.

### A2. Palette extracted from the approved artwork

Semantic design tokens will be based on the logo rather than scattered hard-coded colors:

- Ink / background: near-black blue-black
- Surface 1 / Surface 2: deep navy-violet
- Electric violet: primary interactive accent
- Purple: secondary accent
- Magenta: energetic/highlight accent
- Coral/red: alert/emphasis accent
- Orange/gold: warm highlight and premium/revenue accent
- White / muted lavender-gray: text hierarchy

The brand gradient is a controlled violet → purple → magenta → coral → orange transition. It is used for primary CTAs, selected states, focus accents, charts/highlights and carefully limited glow—not as a noisy background everywhere.

### A3. Global design tokens

Introduce/standardize CSS custom properties for:

- brand colors and gradient
- background/surface/elevated/glass surfaces
- text/muted/subtle text
- semantic success/warning/danger/info
- borders and focus ring
- shadows/glows
- radii
- spacing and shell gutters
- control heights

Existing CSS should consume semantic tokens instead of legacy gold/teal/blue values.

### A4. Product surfaces

Apply the identity consistently to:

- Public/viewer shell and navigation
- Home/discovery and content cards through shared variables
- Search, channel pages, video detail/player surroundings
- Auth/register/upload surfaces through global tokens
- Creator Studio shell and all Studio pages
- Admin shell and all Admin pages
- PWA theme color / manifest
- Loading, error, empty and focus states

The player itself should remain visually restrained so content stays dominant.

### A5. Accessibility / responsive requirements

- Keep high contrast for text and controls.
- Preserve `prefers-reduced-motion` behavior.
- Keep visible keyboard and TV-remote focus rings.
- Use fluid spacing and mobile-first layout.
- Avoid relying on color alone for financial/payment status.

## 4. Workstream B — Creator Monetization Center

### B1. Creator financial overview

Upgrade `/studio/monetization` with:

- Estimated earnings
- Finalized earnings
- Available balance
- On-hold/pending-payout balance
- Payout threshold and progress
- Current revenue share / contract source
- Revenue trend by month
- Revenue by video
- Recent ledger activity
- Payout history
- Clear status labels and explanations

Where data is not yet attributable, show a truthful unavailable/empty state rather than invented metrics.

### B2. Payment profile

Add a creator payout profile containing:

- Legal beneficiary name
- Preferred currency
- Payment method/provider selection
- Masked destination label only for display
- Country/region metadata where operationally required
- Identity/KYC status
- Tax status
- Timestamps and audit trail

Sensitive destination details are encrypted at rest with an application key. API reads return only masked destination information.

### B3. Payout request workflow

Creator can request payout when:

- finalized unassigned balance is positive,
- balance meets admin-configured threshold,
- payment profile is complete enough for manual processing,
- no conflicting payout request already owns the same ledger entries.

Initial payout provider is `MANUAL`.

Payout states remain explicit: pending → processing → paid, with failed/cancelled releasing ledger entries back to available balance.

### B4. Provider adapter contract

Create a narrow payout-provider interface so future providers can be added without changing revenue-domain logic.

Initial implementation:

- `MANUAL` provider: creates an auditable manual-review handoff, no external network call.

Future adapters can support:

- bank transfer provider
- PayPal
- Payoneer
- Wise
- another global payout provider

No future adapter is marked connected until credentials and live verification exist.

### B5. Revenue disputes

Add creator disputes for earnings/payout issues:

- category
- linked payout where applicable
- creator message
- status
- admin resolution / note
- timestamps

Creator sees dispute history; Admin can review and resolve it with audit logging.

### B6. Statements / export

Provide creator-side statement/export support using the ledger and payout records. V1 may export CSV/structured statement data without adding a paid document dependency. A later branded PDF invoice/statement generator can sit on the same statement contract.

## 5. Workstream C — Admin Control Center

### C1. Dashboard upgrade

Admin home becomes an operational command center with:

- Core platform counters
- Analytics snapshot
- Revenue snapshot
- Pending payout count/value
- Open moderation work
- System/API/database/media-storage status surface
- Quick links to high-impact queues

Avoid claiming metrics are realtime when they are query-time.

### C2. Global search

Add one admin-only global search endpoint and UI that can locate:

- account by email/name
- channel by name/handle
- video by title/slug
- payout by id/external reference when present

Results route the operator directly to the relevant admin surface.

### C3. Payout operations

Extend Admin revenue controls with:

- pending/processing/paid/failed/cancelled filters
- payout details and creator/payment-profile summary
- safe status transitions
- external payment reference
- failure reason
- mandatory operator reason for impactful changes
- full audit log entries

### C4. Creator finance administration

Admin can inspect:

- effective contract and revenue share
- ledger entries
- creator payment profile status (masked only)
- payout requests
- disputes
- manual adjustments with reason

### C5. System health

Expose a safe admin health summary for:

- API process
- database connectivity
- R2 configuration/readiness status using existing adapter/configuration only

This is observation only. It must not redesign or mutate the R2 architecture.

### C6. RBAC / audit / destructive safety

All new admin endpoints stay behind `AuthGuard + AdminGuard` and use the existing audit-log mechanism. High-impact state changes require a reason and valid state transition. No raw database/server access is added to Admin.

## 6. Database evolution

Use forward Prisma migration(s) only.

Planned additions:

- `CreatorPayoutProfile`
- `RevenueDispute`
- additional payout metadata needed for provider/method/request source

Add indexes for channel/status/requested-at and dispute queues. Add relations to existing `Account`, `Channel`, and `Payout` where needed. Do not remove existing production-facing fields.

## 7. API evolution

Creator revenue API additions should remain under `/creator/studio/revenue` and include:

- `GET /` enhanced overview
- `GET /payment-profile`
- `PUT /payment-profile`
- `POST /payout-requests`
- `GET /disputes`
- `POST /disputes`

Admin additions should remain under existing admin domains:

- `GET /admin/control/search`
- `GET /admin/control/health`
- enhanced `/admin/revenue/payouts`
- admin revenue-dispute list/update endpoints

All input is validated server-side.

## 8. Implementation order

1. Commit this plan and implementation prompts.
2. Add official brand asset and global design tokens.
3. Replace shell branding and legacy accent colors in Viewer, Studio and Admin.
4. Add monetization data model + migration.
5. Add encryption boundary, payment-profile and manual payout adapter.
6. Extend creator revenue API and tests.
7. Rebuild Creator Monetization UI.
8. Add admin global search/health and finance operations.
9. Rebuild Admin dashboard/revenue experience.
10. Run formatting, lint, typecheck, unit/integration tests and production build in CI.
11. Fix all regressions introduced by this work before merge.

## 9. Acceptance criteria

### Brand

- Approved AYIN logo is visible in Viewer, Studio and Admin shells.
- No primary shell still uses the previous gold/teal/blue identity.
- Global token set drives shared colors and focus states.
- PWA theme matches the new near-black/violet identity.

### Creator Monetization

- Creator can see estimated/final/available/on-hold states.
- Threshold and contract share are clear.
- Creator can save a payout profile without exposing sensitive details afterward.
- Creator can request a payout only when server-side rules permit it.
- Creator can open and review revenue disputes.
- No payout provider is falsely reported as connected.

### Admin

- Dashboard reflects current revenue support instead of stale Task 23 messaging.
- Global search is protected and usable.
- Admin can manage payout workflow safely with reasons/audit.
- Admin can review creator disputes.
- Health view observes current API/database/R2 readiness without changing media architecture.

### Quality

- Prisma schema/migrations validate.
- Typecheck passes.
- Relevant unit/integration tests pass.
- Web production build passes.
- No secrets are committed.
- Existing R2 direct-upload behavior remains unchanged.

## 10. Smart implementation prompts

These prompts are stored here so future agents continue the work without drifting.

### Prompt A — Brand system

> Read the current AYIN master plan, AI rules, this implementation plan, `globals.css`, Viewer shell, Studio shell and Admin shell. Use the approved AYIN logo asset and the semantic brand tokens defined here. Replace legacy identity colors with AYIN violet/magenta/coral/orange tokens while preserving accessibility, TV focus behavior, responsive layouts and content readability. Do not alter media upload/storage architecture. Run format, lint, typecheck, tests and web build.

### Prompt B — Creator Monetization Center

> Read the current revenue Prisma models, revenue service/controller/schemas, Studio monetization UI and this plan. Implement the complete repository-side Creator Monetization Center: enhanced balance states, payout threshold/progress, encrypted payout profile, manual payout provider adapter, creator payout requests, recent ledger data, payout history and creator revenue disputes. Never expose encrypted payout destination data. Validate ownership server-side and audit high-impact changes. Do not connect or fake external payout providers. Add migrations and tests, then run all quality gates.

### Prompt C — Admin Control Center

> Read the existing Admin guard/RBAC, audit service, admin control service/controller, revenue admin APIs and this plan. Implement a cohesive Admin Control Center with global search, revenue/payout operational summary, payout review/status transitions, revenue-dispute workflow, safe system-health summary and improved dashboard UX. Keep all endpoints protected, validate inputs, require reasons for high-impact actions and write audit records. Do not expose secrets or raw database/server access. Keep R2 architecture unchanged. Add tests and run all quality gates.

### Prompt D — Regression / release QA

> Inspect the final diff against main. Verify the approved AYIN identity is consistent across Viewer/Studio/Admin, creator finance workflows are server-authorized and truthful, Admin operations are audited, sensitive payout details never return in plaintext, and no Cloudflare Worker/transcoding/HLS infrastructure was introduced. Run format-check, lint, typecheck, tests, integration tests and production build. Fix all failures caused by this branch. Report only genuine external requirements separately.

## 11. Explicitly deferred external work

- Live payout-provider credentials and provider onboarding
- Production KYC vendor integration
- Production tax form/vendor integration
- Branded PDF invoice/statement signing if a legal/business format is later required
- FAST/HLS/SSAI/DAI/Cloudflare Worker media changes

These deferrals must not block repository-side design, adapter contracts, validation, UI states, tests or manual payout operations.