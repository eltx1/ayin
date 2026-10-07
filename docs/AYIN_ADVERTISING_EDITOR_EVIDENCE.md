> Recovery note (2026-10-07): This is the original October 6 evidence record. Its source bytes were recovered and verified against the prior Git blob. The original local screenshots and logs are unavailable in the resumed workspace; the historical results below do not certify the reconstructed candidate. Fresh acceptance must be recorded separately.

# Advertising editor and write authority evidence

## Source and scope

This release combines the frozen editor source
`5de6013bcc6213a135e810bcc1083bfebc8399c4` and write-authority source
`72030cf4bccb2afa0dadbc4f041321f0c3dee9b5` on reviewed Product Controls base
`c03eb3b1da0eae4e2015991293fea4edac18e906`, which includes native-policy source
`0b6c3677b1387e255748d61fa036065fde8c8cb7`. All eight component commits applied
without conflicts. The assembled application files are compared with the frozen
component blobs; no application change is introduced during assembly.

The changes cover the existing Admin Advertising inventory, placement, creative,
page-setting and authorized-seller editors. Shared form controls, localized EN/AR
copy, native validation, explicit discard/delete confirmation, and readable
configuration summaries replace the remaining legacy controls and technical
output. Campaign choices show existing authorized campaign and advertiser names.
The control explicitly says it filters loaded campaigns; it does not claim a
complete remote search. The existing campaign read currently returns its full
authorized list, and this change adds no endpoint or permission.

The direct advertiser/campaign workspace retains its existing provider, scope
checks, command receipts and recovery. Its provider remains mounted while the
legacy editors lose access. Legacy metadata is tagged with the current Admin
lease before it can reach that provider. Campaign refresh notifications also
remove stale legacy creative records after campaign deletion.

No schema, role, seller-file syntax, delivery, budget, revenue, emergency-stop,
provider credential or CSP semantics change. No production data or credentials
are used in the acceptance tests.

## Draft and mutation behavior

The editors reuse the current AdminAccess coordinator and a bounded in-memory
draft slot. They do not introduce another session system or browser persistence.
Existing scope invalidation clears retained material. The legacy private boundary
becomes hidden and inert synchronously and scrubs native field values, checked
state and open dialogs when its lease is revoked.

The transport checks the current actor/session before and after operations and
sends the existing expected-account/session headers. Read failures leave local
editing available, while dispatch remains blocked until the required current
state is restored. Same-session MFA review retains the original target and draft;
it never replays a mutation automatically.

Known acknowledgment and the submitted draft reset are retained synchronously
before an optional refresh. A failed or held follow-up read cannot turn an
acknowledged create back into an undispatched draft during Admin navigation.
Unknown outcomes retain a separate marker and require explicit record review.
Legacy endpoints do not have correlated mutation receipts. Generic legacy error
codes that can mask a commit or a failed post-commit snapshot therefore remain
conservatively uncertain, including when talking to an older API.

## Backend linearization contract

The existing AccountWriteActor and lockAdminAccountWrite contract now also wraps
the legacy emergency-stop, placement-create/update, creative-create/update/delete
or archive, seller-file and page-setting paths. Controller methods forward the
existing authenticated actor. They preserve explicit authorization and validation
failures and do not recast unknown database failures as definite rejection.

The lock order remains staff/MFA advisory, credential, then sorted actor account
locks with current role/session and step-up checks. Existing changes and audit
records commit together; page settings retain their existing no-audit behavior.
This provides a stronger write linearization contract, not evidence that the
previous request-entry authorization semantics were a bypass.

The real PostgreSQL proof covers both orders for all nine write paths:

- Revocation commits while holding the authority lock before the write reaches
  its boundary: the write returns 403, with records and audit unchanged.
- A legitimate write owns authority first: later revocation waits, the write and
  its existing audit commit, and a subsequent request is denied.

The proof uses actual database lock waits and a transaction trigger rather than
mocked authorization or persistence. Creative archive history and page audit
baselines are checked explicitly.

## Completed component acceptance

Frontend application checks ran at
`122b06d6b0dd34c0320fc306eda6d53859bdb4b5`. The final frontend commit only adjusts
the synthetic fixture's enrollment-audit baseline; all application sources are
byte-identical.

| Frozen source       | Passed checks                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend `5de6013b` | Full web types and lint, 830 web tests across 124 files, API production build, Next production build; 35 real Chromium cases against synthetic local PostgreSQL                                |
| Backend `72030cf4`  | Packages, full API types and lint, 599 unit tests across 114 files, API production build; 80 real PostgreSQL cases across the new editor proof and existing workspace/account-authority suites |

The browser set includes ten new editor cases and the existing advertising
navigation/direct-campaign suites. It covers EN/AR at 390px and 1440px, selection
from 102 campaign records, actual disabled-placement/creative writes, dirty draft
recovery, MFA review, a lost write response followed by history navigation,
acknowledged placement/creative creation followed by a held refresh and Admin
navigation, held preflight with a changed role, and synchronous field concealment.
Audit assertions compare against the synthetic MFA enrollment baseline and still
detect every new action. Transport tests separately cover held responses, changed
accounts/sessions/auth versions/roles, invalid acknowledgment targets, and no
replay after MFA.

The final browser run passed all 35 cases in 190.39 seconds. The backend run
passed all 80 integration cases in 35.51 seconds, including 18 new ordering cases.
Each used a fresh local PostgreSQL cluster. Both runners verified ports 3000,
3001 and 55673 closed, no PostgreSQL PID file, and removal of their own database
directory after shutdown. Earlier failed acceptance output was preserved before
the corrections and final reruns.

Twelve original final screenshots cover inventory, creative and sellers in each
locale/width combination. Independent source review accepted the acknowledgment
recovery and authority changes; final original EN desktop creative and AR mobile
seller screenshots were independently inspected for readability. The existing
browser workflow now preserves these PNGs in the
`admin-advertising-editor-visuals` artifact, matching
`test-results/**/advertising-editor-*.png` with seven-day retention.

## Assembly-only changes and acceptance limits

Assembly includes the following test-only compatibility handling:

- The new authority integration proof allows only loopback hosts and the known
  isolated database names `ayin_e2e` or `ayin_test`. The former was used locally;
  the latter is used by the existing database CI job and its other safety guards.
- The reviewed Product Controls base already carries the separately requested
  ad-consent lifecycle expectation correction to `/test.mp4`, matching
  its already-renamed fixture. This is the one-line expectation correction for
  the independently observed successful DAI transition, with no player change.

The dedicated screenshot upload and this evidence document are the other
assembly additions. The test-name guard and inherited fixture expectation are checked at
source level here; the database/browser suites have not been rerun for the
assembly-only changes. No build, browser or database runtime has been run on the
combined release tree. Component pass results above must not be represented as a
combined-tree CI pass. The final exact release tree still needs its ordinary
publication checks.

## Review and reproduction entry points

- UI composition: `apps/web/src/components/admin/admin-advertising-control.tsx`
- Fields and labels: `apps/web/src/components/admin/admin-advertising-editors.tsx`
  and `apps/web/src/lib/i18n/resources/admin-advertising-editor.ts`
- Retained drafts: `apps/web/src/components/admin/admin-advertising-draft-shelf.tsx`
- Scoped transport: `apps/web/src/lib/admin-advertising.ts`
- Browser proof: `tests/e2e/admin-advertising-editor.acceptance.spec.ts`, with
  `admin-advertising-editor-fixture.mjs` in the same directory
- Backend authority proof:
  `apps/api/test/advertising-editor-authority.integration.test.ts`
- Backend error/actor tests:
  `apps/api/src/ads/advertising-editor-authority.test.ts`

Use the repository's normal package build, web/API typecheck, lint and test
commands. The focused browser set is the editor spec plus
`admin-advertising-navigation.acceptance.spec.ts` and
`admin-direct-campaign.acceptance.spec.ts`. The focused integration set is the new
authority spec plus `advertising-workspace.integration.test.ts` and
`admin-account-write-authority.integration.test.ts`. These mutation suites require
a disposable loopback PostgreSQL database: the fixtures truncate their synthetic
records. The existing browser/database workflows provide that isolated setup.
