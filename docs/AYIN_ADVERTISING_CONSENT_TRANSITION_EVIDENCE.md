# Trusted advertising consent transitions

This bounded follow-up starts from lifecycle commit `405833d55e05c929e2bb622f04716be70a2cb854`. It extends the existing provider/SDK boundaries; it does not register a production CMP, activate demand, infer age from an account/device/profile, alter revenue eligibility, or change CSP.

## Optional provider contract

`AdvertisingConsentProvider` still exposes `getSnapshot()`. A trusted browser integration may additionally expose `subscribe(listener)`, notify after updating its snapshot, and return an unsubscribe function. Snapshot-only integrations remain readable; they cannot announce live changes. The normalized snapshot is frozen and referentially stable until its normalized fields change. Duplicate notifications do not redecide or replay ads.

Provider replacement and removal detach the previous binding. A binding generation rejects stale callbacks even if the same provider is restored later, and out-of-order disposal cannot restore a disposed provider. A throwing subscription does not publish provisional personalized permission. Malformed/missing updates use LIMITED_ADS and retain the strongest previously explicit CHILD/TEEN restriction; they do not infer a new classification. Server tag restrictions remain independent and are never removed by the client.

Consent scopes revoke synchronously before React store notifications. A revoked scope stays revoked even if consent later returns to the same values. This is disposable authority for the existing SDK requests, not another viewer identity, progress, playback or ad session architecture. Server rendering retains the safe default. No production caller registers a consent provider; certification and a deployed trusted bridge remain external work.

## Optional opaque provider revision

The normalized mode/source/providerManaged/age fields do not describe every vendor or purpose decision a future trusted adapter may make. The additive `providerRevision` contract lets that adapter invalidate local authority when those fields stay identical. It is optional, bounded to 1–128 ASCII letters, digits, dots, underscores, colons or hyphens, and is never interpreted as permission. It must contain a local opaque revision rather than a consent string, vendor list or viewer identifier. The adapter is responsible for advancing it when an otherwise unrepresented change requires revocation; identical fields without an advanced revision cannot reveal that change.

An added, removed or changed revision participates in normalized snapshot identity and therefore uses the same synchronous teardown and redecision already described here. Identical notifications preserve the snapshot reference and playback. Malformed supplied revisions use the existing LIMITED_ADS fallback, retaining an already known age restriction. No revision is added to GPT privacy settings, script URLs, IMA tags or AYIN event telemetry. Snapshot-only providers that omit it remain compatible. This does not implement or certify a CMP, vendor/purpose evaluation, upstream restrictions or a production bridge.

The separate revision follow-on starts from `cf4a19da6d178981c0022afc0e07b9a11ee1e933`. Its final checks pass: 792 Web unit tests across 116 files, the 39-case consent/Google focused subset, Web TypeScript, changed-file ESLint and formatting/diff checks, and all five actual-component Chromium journeys. The new same-mode native case fails against the unchanged source with zero synchronous manager destructions, then passes with the revision contract. It checks destruction and computed concealment before firing captured old callbacks, zero retained frames, unchanged content DOM/time, no replay of consumed breaks, duplicate-notification stability and no revision in ad tags or event telemetry. Baseline logs and trace are retained separately from the passing run. All requests use synthetic SDK/media/API fixtures and each journey verifies zero external requests.

This follow-on uses private dependency directories with read-only links to the previously verified frozen consent installation, including its unchanged package outputs. The first broad unit attempt lacked a link needed by a test importing API source (`zod`); correcting that local dependency setup yields the complete 792-test pass. The diagnostic is retained separately. The five component journeys validate this source delta; the earlier production build and 27 app journeys below remain evidence for functional commit `269624ad`. No new production CMP/provider registration or CSP change is introduced.

## Consumers and preserved behavior

| Consumer                   | Change handling                                                                                                                                      | Preserved content behavior                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PageAdSlot / GPT           | Abort decisions/queued mounts, destroy the old slot, hide the old house/GPT host, remove provider frames, and redecide through the existing endpoint | No surrounding page or player remount; duplicate normalized updates do not churn inventory                                                                        |
| AdEnabledAyinPlayer / IMA  | Cancel pending initialization/current ad authority, destroy the old loader/manager, conceal provider frames, and read a fresh decision               | The video/progress component stays keyed only by videoId; position and consumed pre/mid/postroll flags are retained; withdrawn active pre/midroll resumes content |
| Creator TV progressive MP4 | Observe current consent through the same IMA wrapper                                                                                                 | Consent alone does not replace an already selected MP4 stream with DAI or reset its position                                                                      |
| Creator TV DAI SSB         | Revoke the existing LiveAyinPlayer signal and use its existing teardown, then select progressive fallback                                            | Existing conceptual program offset is retained and capped just before the program end; this is still best-effort progressive synchronization                      |

The current DAI adapter cannot represent trusted CHILD/TEEN restrictions. Explicit age therefore selects the existing IMA fallback. Once consent changes an active TV session to progressive fallback, a later permission upgrade does not replace its ongoing content merely to return to DAI. Initial hydration snapshots which never acquired stream authority do not force an unnecessary fallback.

The optional LiveAyinPlayer signal invalidates its existing attempts, timers and callbacks and stops its media; it does not add another reconnect/player implementation. Queued callbacks cannot restart an old stream or emit stale opportunity events after revocation.

Imperative `hidden` state is backed by explicit component CSS overriding the existing display rules. Page, IMA and DAI concealment is synchronous, before React commits. GPT/IMA iframe nodes are removed at that same boundary. Stale house links prevent default navigation and do not record clicks. Cleanup cannot retract a provider/telemetry network request already issued before revocation.

## Deliberate external boundaries

- LIMITED_ADS cannot reuse a known standard or unknown GPT script as though it were the limited loader. The previously unknown-script transition now fails closed. No clearing privacy values are added to GPT.
- The CSP incompatibility documented in the prior lifecycle evidence remains unchanged pending its separate security-policy approval. The component tests use synthetic already-loaded SDKs; they do not bypass the production CSP or claim its blocked loader works.
- Existing non-Google/owned VAST URLs remain unchanged by Google's tag normalizer. Local old request authority is revoked, but no third-party consent/age protocol or upstream policy enforcement is invented. Google-specific assertions must not be represented as certification of those sources.
- No live Google fill, revenue, certified CMP/TCF integration, trusted regional classification, native SDK delivery or physical-device readiness is established by these tests.

## Verification scope

Focused tests exercise stable snapshots, duplicate updates, replaced-provider callbacks, out-of-order disposal, immediate revocation before UI notification, malformed update safety, late GPT commands, unknown-loader rejection, pending IMA SDK cancellation, captured old IMA callbacks, stronger server tag preservation, DAI age eligibility and its existing fallback timeline.

The separate browser component harness bundles the actual React components with the already lockfile-pinned Vitest/Vite toolchain. It registers a provider only in test fixtures, supplies synthetic SDK/media implementations, intercepts all API traffic, and rejects external requests. No test route, global test hook or provider registration is added to the shipped app. Its StrictMode journeys check computed visibility and iframe teardown inside the consent-change call, old callbacks, content DOM/position preservation, non-replayed breaks, DAI-to-MP4 offset and revoked house click prevention.

Final local verification of functional commit `269624add5ebd3139fbc322d0a1c0c685c4e09b3`:

- 785 Web tests across 116 files pass; the 43-case focused consent/runtime/Creator TV/Live subset passes.
- All four new StrictMode browser component journeys pass, including same-task computed `display:none`, iframe removal and blocked stale clicks/callbacks. The harness rejects external requests, and each journey verifies zero such requests.
- All 27 existing production-app Live/HLS/Watch/Kids browser cases pass, including the four prior lifecycle regressions, mobile gesture handling, native-HLS teardown/watchdogs, content fallback and Kids' zero general-ad/social requests.
- Full Web ESLint, TypeScript, formatting/diff checks and the Web production build pass. Own Prisma generation and package/API compilation also pass.
- Web/API/PostgreSQL processes are stopped; the owned cluster has no postmaster PID, and its application/database test ports are closed.

Dependency provenance is explicit. The initial donor contained source-map-js 1.2.1/mysql2 3.22.0, which did not match the lockfile. Definitive validation used an owned `pnpm 11.24.0 install --frozen-lockfile --offline` installation: 608 reused packages, zero downloads, source-map-js 1.2.2, mysql2 3.23.1 and regenerated Prisma 7.10.0. The donor was not mutated. Unit checks unset public API/media overrides to use their expected default environment; production builds/browser runs use the controlled loopback environment.

Two harness preparation failures (Vite's array output shape and absent global layout tokens) were corrected before the four passing journeys. One unrelated upload-session unit assertion initially failed when the browser environment's loopback API override was applied to default-environment units; the complete isolated unit rerun passes. These diagnostics are not product regressions or accepted results.

One separate backend observation remains open: synthetic burst ad telemetry triggered HTTP 500 from `VideoAdService.recordEvent`'s placement upsert, with PostgreSQL reporting `AdPlacement_key_key` for `player_pre_roll`. The same collision appeared in preceding lifecycle baseline evidence. Client playback/consent assertions do not establish end-to-end event persistence or revenue correctness, and this delta does not change that backend path or apply historical financial corrections.

## Secret-scan diagnostic

The unchanged pinned scanner reported `generic-api-key` for the synthetic media filename at `tests/e2e/fixtures/ad-consent-harness.tsx:304`. Redacted CI run `37436610914`, job `112179855058`, identifies original commit `ff3ec05c3d509baaa253b60e33309136e8a839e1`. This field is a public test object path, not a credential. The fixture now uses `test.mp4`; no scanner exemption or suppression was added. The reviewed player/consent tree is republished as one commit atop corrected Recovery to remove the false-positive intermediate diff from the changed-commit scan. Exact final gates remain required.
