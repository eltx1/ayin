# Admin Kids classification: native selection and reviewed policy

## Scope and status

Integrated Phase 7/14 candidate based on accepted upload-authority main `c8234f8897d029860ab4d7e6f82c202ed4b1d8eb`. The separately reviewed native UI and current-authority backend are combined here. This is one bounded Admin surface, not completion of either phase or the Web/PWA master. Its own combined tests, CI, merge and deployment remain separate gates.

The old raw Video UUID form is replaced with the existing verified admin video directory, selected-record identity and an explicit current-policy read. Existing backend routes, response contracts, schema, role scope and classification rules are preserved. All three policy writes now revalidate current authority inside their transaction. No real production policy is changed by this candidate.

## Actual behavior

- Reuses `getAdminVideos` and `/admin/control/videos`, with real 25-row server pagination and video/channel-name search (the existing API also matches slugs). Operations and content moderators can select drafts/private videos; the operations-only, playable-catalog picker is deliberately not reused.
- The normal directory excludes removed videos. If a removed record is supplied by the endpoint's explicit status filter, its selected policy remains readable but its decision form is absent. Conflict messaging covers account, permission and selected-video changes/unavailability without misidentifying a target-removal rejection.
- The selected record shows title, channel, handle and stable identity. Choosing a record does not classify it. The native decision form appears only after a successfully parsed policy read for the exact selected ID and unchanged administrator account/roles.
- The directory uses compact responsive list rows, with grouped title/channel metadata, real status badges and inline44px selection actions. Mobile moves metadata above the status/action row without the previous full-width card gaps. The final EN/AR desktop captures show13 complete rows, compared with3 in the rejected card stack; mobile shows4 complete rows. Automated acceptance checks at least eight complete desktop rows, bounded row/action sizes and44px actions; identities remain wrap-safe in EN/AR.
- Native `PageHeader`, `FormSection`, labeled select/textarea controls, `ActionButton`, `DataBadge`, `StatusNotice` and `PageControls` have EN/AR content and preserve RTL. One route-local identity rule bounds mixed-direction text without modifying shared design primitives.
- Null maturity is visibly unclassified and excluded from Kids. The editable general-audience default is not displayed as a stored classification. Eligible classification still requires `GENERAL` and `NONE`; the server's trimmed 5–1000-character audit reason bounds are used.
- Reads are uncached, abortable and bounded. New selection/search and background/pagehide discard stale private snapshots; rejected role/account changes conceal private identity and drafts. Explicit directory retry verifies access again.
- Policy reads, writes and their identity reads include the existing server-enforced `x-ayin-expected-account` header. The protected request is bound to the intended actor even if browser cookies change after preflight. Writes use the existing step-up-protected classification route and send only classification values/reason. A synchronous write guard prevents repeat submissions. A response must acknowledge the exact target and requested values before success is shown. It is not automatically refreshed or replayed.
- Step-up rejection and unconfirmed writes preserve and lock the draft. Reauthentication does not replay the action. A fresh original-target policy read plus explicit review is required before another attempt. An exact acknowledged save followed by failed post-write identity verification produces only a generic saved confirmation, with private records/drafts concealed. A later outage or account change is not mislabeled as an unconfirmed write.
- Draft replacement and ordinary same-tab departure ask before discarding. Pagehide intentionally clears private data and requires re-verification rather than restoring an old private snapshot. Concealment synchronously scrubs query/reason current and default native values, checkbox state and select values before React removes private controls; ordinary same-account failed search and uncertain-write draft retention are unchanged.

## Verification

The following UI-only preparation results were executed before integration; they are not relabeled as combined-source certification:

- Frozen pnpm install and workspace package builds passed.
- Web TypeScript and full Web lint passed; new E2E source lint, formatting and `git diff --check` passed.
- Full Web unit suite: **555 tests / 94 files passed**. Focused policy/directory transport subset: **22 passed**, including eight new classification-boundary tests.
- Existing API classification and video-policy suites: **14 tests / 2 files passed**.
- Production API and Web builds passed. Web retains the pre-existing Edge-runtime instrumentation stdout/stderr warnings.
- Actual Chromium + API + isolated PostgreSQL 17 acceptance: **11 tests passed**. Migrations applied to a disposable local database; PostgreSQL explicitly uses UTC. Next binds `0.0.0.0` for this execution environment's loopback behavior. Test-only network interception controls failures/late responses; success and lost-acknowledgment mutations go through the real API and database.

Browser coverage includes EN/AR draft/private selection; 27 records over two pages; truthful empty results; no form before explicit policy read; contradiction blocking; one write for repeated submit; exact durable audit target; preservation of allowed/blocked territories, rights expiry and an existing independent override; directory/policy retry; a late prior-target policy; role change while a real policy response is held; committed-but-lost acknowledgment with no replay; real expired step-up rejection and retained draft; cancelled target/navigation changes; pagehide concealment followed by a fresh read (including synchronous and detached native value checks); an actual cookie switch between preflight and PUT rejected with409 and zero writes/audits; and acknowledged writes followed by either a post-read503 or actual account-change409, both retaining public success without exposing private facts; and default removed-video exclusion plus defensive read-only handling of an actual explicitly filtered removed record.

Twelve renderer screenshots were generated and their actual pixels inspected: EN/AR at 390 and 1440, each with directory, heading and editor views. Initial Arabic mixed-direction identity clipping was found by image review despite no document overflow; it was corrected and the final browser suite checks rendered identity text bounds as well as field bounds, one H1, 44px checkbox target and document containment. The final artifacts are the `kids-{en,ar}-{390,1440}-{directory,heading,editor}.png` outputs of `admin-kids-classification.acceptance.spec.ts`.

Environment-only interruptions were resolved without product changes: an initial full lint was killed while shared temp storage was pressured; a browser retry ran out of `/tmp`; subsequent tests use workspace-local temporary storage. One initial full Web test run inherited the E2E `127.0.0.1` API override while an existing upload test expects the normal `localhost` default. Re-running the unit suite without that E2E override passed all tests.

A first boundary-regression run passed9/10; the last browser page crashed while a production rebuild overlapped that run. The final sequential build/browser rerun passed all10, including the post-acknowledgment account-change case. The failed observer is retained as a failed run, not acceptance.

## Remaining boundaries

- The integrated backend covers current actor, session, MFA, step-up and target authority for classification and both override mutations. Broader unrelated control centers remain separate.
- Existing policy API has no optimistic classification version in its public payload. This UI does not invent cross-administrator conflict detection or claim that earlier reads prevent another authorized administrator's changes.
- Hidden/background state is deliberately discarded for privacy. Same-document programmatic history navigation, broader Admin localization and all other master surfaces remain outside this slice.
- No live catalog/classification changes, provider calls, CI certification, production deploy or legal compliance claim is included.

## Integrated backend authority and regression evidence

All three policy writes pass the full authenticated actor into the transaction. Existing administrator account/MFA locks precede the Video lock, which precedes the policy or override row lock. Authority is checked again after those waits. Missing, REMOVED and removedAt-tombstoned targets cannot be changed. The prior policy state is read under the same serialization used by the write and its audit, and audit failure rolls back the mutation.

The creator metadata writer takes the same Video lock before policy work. A real absent-policy overlap negative control failed without this four-line prerequisite; Quick Upload already uses the compatible order. This is serialization, not a new creator classification capability. The existing shared upload-authority UTC session-expiry fix remains intact.

The backend preparation passed 66 new real PostgreSQL cases, 421 source unit cases, and the full configured 175-file/966-case suite, plus build, types, lint and formatting. The full suite exposed a pre-existing dashboard fixture dependence on standalone videos left by another suite. Reproduction without the new tests confirmed it. A one-line test-only TRUNCATE extension includes Channel so its existing cascading videos are isolated; dashboard assertions and production queries are unchanged. The baseline policy-cache/dashboard pair and final 68-case policy/dashboard pair passed. Earlier failed runs are retained as failures.

The integrated workflow preserves original Kids and public continuation screenshot files as a separate downloadable artifact. Twelve compact-layout preparation originals were independently inspected at both sizes and locales; final combined and CI originals still require their own review. No screenshot or density assertion was relaxed.

## Combined local validation and publication union

The combined Kids UI/current-policy-authority application source on accepted main c8234f88 passed root formatting, lint, typecheck, package/API/Web production builds and 1,080 root unit cases (421 API and 566 Web). Clean UTF8/UTC PostgreSQL passed four database bootstrap cases and the full API integration suite: 177 files / 1,012 cases. The first SQL_ASCII test-cluster run failed one existing Arabic normalization case; the explicit UTF8 rerun passed it without changing the application or assertion.

Actual production-build browser validation passed all 11 Kids cases and four existing whole-account scope cases. Independent image review found the Arabic mobile heading capture had not established document top. Screenshot preparation now uses bounded instant scrolling and two-frame settling with exact scrollY zero and whole-H1 viewport assertions; product motion is unchanged. The first stricter capture attempt correctly failed when residual scroll remained.

Repeated execution also exposed standalone test channels accumulating beyond the directory's first page. The test now waits for the verified directory, searches its exact fixture query, then requires the target. It no longer assumes a newly created record appears on page one. Each case records and cleans only its exact created channel UUID plus matching handle, with zero-remnant assertions. The final 11-case replay on an already populated database preserved all 39 pre-existing Kids channels and 1,053 video identities while leaving zero new fixture channels/videos. Earlier failed runs remain failures.

Twelve fresh combined originals were inspected; the four corrected final heading originals were separately re-inspected after exact-top capture. Final owning CI originals remain required before merge.

Publication also retains dependency PR241 and bounded R2-observation PR242. Those independently reviewed prerequisites do not alter the Kids surface, but the exact full publication union requires its own CI; local predecessor results are not mislabeled as that final CI result.
