# AYIN AI Implementation Rules

These rules apply to every AI coding task in this repository.

## 1. Required reading before every task

Before changing code, read:

1. `docs/AYIN_MASTER_PLAN.md`
2. `docs/AYIN_AI_AGENT_RULES.md`
3. The current task in `docs/AYIN_EXECUTION_ROADMAP.md`
4. Existing code directly related to the task

For media tasks also read `docs/MEDIA_ARCHITECTURE_V2.md`, `docs/R2_UPLOADS.md`, and the relevant ADRs in `docs/DECISIONS.md`.

Do not rely on memory from an earlier run. Inspect the current repository state first. Current code is authoritative when an older historical task document describes behavior that has since evolved.

## 2. Work one task at a time

- Complete only the requested task.
- Do not start the next roadmap task automatically.
- Avoid large unrelated refactors.
- Preserve working behavior unless the task explicitly replaces it.
- If a prerequisite is missing, implement only the smallest prerequisite required and document it.

## 3. Do not stall on ordinary product decisions

Use the master plan and sensible maintainable defaults.

Do not ask for clarification for minor naming, styling, folder or implementation choices that can safely be changed later.

Ask/block only when one of these is truly required:

- A production secret or credential that is not available
- An irreversible/destructive production action
- A business/legal choice that cannot safely be represented as an admin-configurable setting
- A direct conflict between explicit product requirements

When a secret is missing, implement the integration completely with environment variables and a graceful development fallback; do not fake successful production connectivity.

## 4. AYIN non-negotiables

Every implementation must preserve these rules:

- AYIN is global. Never hard-code Egypt or any single country into product identity or default UX.
- Every successful registration automatically creates a viewer profile, creator channel, Uploads playlist and Creator TV.
- Creator workflows must be extremely simple by default. Advanced options belong behind optional controls.
- Admin must be able to control operational/business settings without code whenever reasonably safe.
- Cloudflare R2 is the only durable creator-video object store. Never turn AWS/EBS or application filesystems into authoritative creator-media storage.
- Creator uploads go directly from the client to R2; web/API request handlers must not proxy creator upload bodies.
- The existing media worker may use bounded ephemeral local scratch for probe/transcode/package work. Scratch is temporary processing state, must be cleaned, and must never become durable media storage.
- AYIN already has a real `ffprobe`/FFmpeg canonical MP4 pipeline. Do not regress it to the historical playback-ready-upload assumption.
- Production playback currently remains the validated canonical MP4. HLS/ABR generation or playback selection may change only in its explicit roadmap task/ADR, behind safe rollout semantics, while retaining MP4 fallback.
- Web/PWA is the source of truth. Shared UI/business logic should not be duplicated unnecessarily across shells.
- Advertising architecture must support in-player video ads and outside-player display placements.
- Google IMA / Google Ad Manager readiness must not be broken by local abstractions.
- Business values such as revenue share, upload limits, ad density, homepage rows and moderation defaults should be configuration/admin driven, not scattered hard-coded constants.

## 5. Simplicity and UX rules

### Registration

- No separate creator application/wizard.
- Channel/playlist/TV provisioning happens automatically.
- Do not force profile completion before using AYIN.

### Upload

Default path should feel like:

`Choose video -> Upload -> Publish`

Title may be prefilled automatically. Detailed metadata is optional.

Do not expose codec jargon unless validation/processing fails.

### Admin

Admin UX should prioritize:

- fast search
- bulk actions where useful
- clear filters
- direct edits
- safe confirmations
- auditability

Do not create a “developer settings” maze for ordinary platform operations.

## 6. Architecture rules

- Prefer a modular monolith before microservices.
- Prefer explicit module boundaries.
- Keep public web, Studio and Admin separable by modules/routes even if they deploy together initially.
- Use typed contracts/interfaces at boundaries.
- Keep third-party providers behind narrow adapters.
- Make asynchronous/retryable operations idempotent.
- Durable processing readiness must come from authoritative lifecycle state, not merely from an object existing in R2.
- Preserve deterministic media namespaces and processing generations when extending the media worker.
- Use database transactions for account auto-provisioning and atomic state transitions where required.
- Use migrations for schema changes.
- Never commit secrets.

## 7. Security rules

Every task must consider authorization and abuse, not only UI.

At minimum:

- Validate all untrusted input server-side.
- Enforce ownership/roles server-side.
- Rate-limit sensitive endpoints as appropriate.
- Use short-lived R2 upload authorization.
- Do not trust client-supplied channel/user ownership IDs.
- Escape/sanitize user-generated content appropriately.
- Protect admin routes independently from UI visibility.
- Audit high-impact admin actions.

Do not make normal creator UX complicated merely to demonstrate security; security belongs mostly in the implementation.

## 8. Quality gates for every coding task

Before finishing:

1. Run formatting if configured.
2. Run linting if configured.
3. Run type checking.
4. Run Prisma validation/generation when schema is affected.
5. Validate/apply migrations against a clean test database when migrations are affected.
6. Run relevant unit/integration tests.
7. Run production build for affected apps when practical.
8. Fix failures introduced by the task.
9. Check that no secrets or large generated artifacts were added.

If a command cannot run because required infrastructure/credentials are unavailable, state exactly what could and could not be validated.

## 9. Testing philosophy

Prioritize tests for:

- account auto-provisioning
- authorization
- admin settings
- upload authorization and media lifecycle state
- media processing idempotency/retry contracts
- adaptive rendition planning/readiness when applicable
- TV auto-queue behavior
- watch progress
- advertising decision logic
- revenue calculations
- destructive moderation/admin actions

Avoid brittle tests that only mirror implementation details.

## 10. Database and API evolution

- Use forward migrations.
- Keep migrations deterministic.
- Add indexes intentionally for real access patterns.
- Do not delete production-facing fields casually.
- Do not require immediate backfills when an additive rollout can safely tolerate absent V2 rows.
- Validate pagination and limits for list endpoints.
- Prefer stable IDs over mutable handles for relationships.

## 11. Third-party integrations

Cloudflare, Google advertising, OAuth, email and similar integrations must use provider adapters and environment/configuration layers.

Development may use a documented local adapter/mode where appropriate, but production behavior must never be falsely reported as connected when it is not.

## 12. End-of-task report format

Finish each task with a concise report containing:

### Completed
- What was implemented

### Files changed
- Important paths only

### Validation
- Commands/tests/builds run and outcomes

### Configuration needed
- Environment variables or external setup still required

### Known limitations
- Only real limitations relevant to this task

### Ready for next task
- State the next roadmap task number/name, but do not execute it

This consistent stop point prevents long AI runs from drifting, hanging or mixing several tasks together.
