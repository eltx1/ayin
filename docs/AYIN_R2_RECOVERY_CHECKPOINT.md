# R2 recovery implementation checkpoint

Verified checkpoint: 2026-10-09, after successful provider acceptance at 01:35 UTC. Recheck current refs and workflow results before further action.

## Current outcome

The V2 application is deployed at `a6c15842bd2cf6990715f18d58a550a5929d8d41`. Real R2/browser provider observations passed. Issuance was disabled during that run and the tooling did not enable it. The authenticated application canary, private delivery validation, processing/accounting proof and activation decision remain open.

[PR273](https://github.com/eltx1/ayin/pull/273) added identity-bound object evidence, strict bounded completion observation, owner/revision-fenced reconciliation after a lost completion response, and SigV4 byte ordering. Reconciliation does not replay Complete or adopt legacy uploads into recovery sessions.

[PR274](https://github.com/eltx1/ayin/pull/274) implemented finite V2 cleanup and writer accounting. Its reviewed candidate `c63e6e7810b1631f5232011e10b0f31ec074ae84` and merged main have the same tree `feedce6d8d0a4ccabeee337d00ebc86d446a6660`. Exact candidate quality, browser, security and inventory checks passed before merge.

## Deployment and resource recovery

The earlier [deployment 37832988391](https://github.com/eltx1/ayin/actions/runs/37832988391) failed during the production-host Web build with exit 137 before migrations, symlink change or activation. Concurrent resource pressure was observed; the exact historical cause of that process termination was not established.

[PR275](https://github.com/eltx1/ayin/pull/275) moved the production Web build to a validated CI artifact and replaced automatic Cloudflare mutations with read-only endpoint verification. It deployed successfully, followed by the V2 release.

[Deployment 37857712659](https://github.com/eltx1/ayin/actions/runs/37857712659) successfully activated exact release `a6c15842bd2cf6990715f18d58a550a5929d8d41`, using main quality run `37855980608`. Both forward V2 migrations applied. Immutable artifact `11584737511` has ZIP SHA256 `eb8086ce89ab2bee1d45a4d86ebdb8787d6cc531fc684ca9080e832a3aa1c5ff`; its release, validation run, deploy run/attempt and owner were independently verified. Later provider execution required that same clean active release and healthy Web/API readiness. Public liveness/readiness remained healthy after the provider run.

The specifically approved, nonrecursive journal-parent permission repair changed only `/home/ayin` from `0770` to `0750` in [run 37864073268](https://github.com/eltx1/ayin/actions/runs/37864073268). Owner and inode were unchanged, no ACLs were present, and health checks passed. The existing journal guard was not weakened.

## Application protocol and validation

V2 separates accepted source processing, active upload slots, unresolved physical-work reservations and retained cleanup observations. It journals source CREATE/COMPLETE and immutable worker output writes, uses multipart sources with exact-length signatures, and retains UNKNOWN outcomes. Cleanup requires a frozen acknowledged write set plus exact-address absence observations and bounded tombstone rechecks. This is a finite contract, not a promise of eternal provider absence. Historical V1 work remains in its original lane.

Issuance requires an explicit canary tuple, bounded source size, one unretired source and reserved lifetime output capacity. Each measured output write consumes its stored envelope once across retry namespaces. Accepted work drains after new issuance is disabled. COMPLETE performs provider preflight before reserving its single creating dispatch. See [finite cleanup V2](FINITE_MEDIA_CLEANUP_V2.md); configuration alone is not acceptance evidence.

Application validation included all 65 clean PostgreSQL migrations, five populated forward-migration cases, API 1,039 and Web 1,192 unit tests, and 20 Chromium recovery cases using a synthetic provider. The local integration runner reported 355 files / 3,325 tests; it also discovers compiled unit copies, so this is not a count of unique integration scenarios. Lint, format, typecheck, builds and four native compiled-import checks passed. These results are distinct from live R2 evidence.

## Actual provider acceptance and replay barriers

The approved scope was only `ayin-production-media/ayin-recovery-acceptance/34c4947c-ba13-4fc9-9087-0d1db8cc4d28/`: three synthetic keys, about 10 MiB, and cleanup of those owned fixtures. Existing user media was not selected for deletion.

The original [attempt 37865837186](https://github.com/eltx1/ayin/actions/runs/37865837186) created only the small allocation, then failed with `STDIO_PROTOCOL_FAILED`. That known allocation was aborted and observed absent. The other two keys were untouched. Its original journal remains FAILED with SHA256 `c53016b757a13409abaebc0063779f2eae4722ca59fd692e9c67562471e2df6f`.

[GET-only diagnostic 37867414387](https://github.com/eltx1/ayin/actions/runs/37867414387) demonstrated HTTP 403 that browser JavaScript could not read under CORS for a signature failure: browser JavaScript saw a network error while a bounded non-browser response contained `SignatureDoesNotMatch`. The harness's browser-visible error-body requirement was invalid. This did not retrospectively establish the earlier PUT's exact response. [Read-only CORS inspection 37868758595](https://github.com/eltx1/ayin/actions/runs/37868758595) confirmed the existing AYIN PUT/ETag configuration without changing it.

The [fixed continuation 37870328279](https://github.com/eltx1/ayin/actions/runs/37870328279) passed against deployed adapter `a6c15842`, using reviewed tooling `b75b1ec4e9f4b7493879b2555ef786a9fe2ad761` and invocation `390a2992121ab554109683a6952297dea5af0bd1`. It used only the two untouched keys, bringing total CREATE dispatches to three. A separate exclusive suffix journal binds the original digest.

Verified coverage: direct wrong-length rejection and empty provider parts; real browser two-part resume/completion; full readback identity/metadata checks; successful part upload followed by abort; exact owned object deletion; and fresh exact absence after grant expiry. Both remaining fixture debts are false. The original failed result was not rewritten. Discarding an acknowledged completion receipt is not proof of an unknown provider outcome. Single-part completion was not covered here.

Artifact `11590645540` has ZIP SHA256 `dabea6dcfcbc04aa594250bd151a92c647ad7a63b0a55d560584b7b445aaf95f`; its sole reconstructed JSON proof was independently validated. [Continuation evidence](R2_OWNED_FIXTURE_CONTINUATION.md) records source hashes and boundaries. Both permanent journals remain replay barriers. Temporary source files were removed through recorded ownership/identity checks. Never rerun either provider command or delete a journal to obtain another attempt.

## Remaining gates

- Complete exact-head CI/review for [PR276](https://github.com/eltx1/ayin/pull/276), preserving tooling fixes and this evidence. The separately reviewed harness already ran against the deployed adapter; its tooling SHA is not an application deployment SHA.
- Verify an ordinary authenticated OWNER session, exact target/channel, private object delivery, live worker bounds, quota and unresolved-work baseline. An application visibility label alone does not certify object-delivery privacy.
- Obtain the concrete canary activation/owned-cleanup approval, then exercise the tiny private application upload, reload/reselect/reconcile, integrity processing, retained-output accounting and staging settlement. The separate provider fixture approval does not authorize application fixture deletion or security/access changes.
- Keep new issuance disabled until these application gates and an explicit rollout decision are satisfied. Report unresolved debt and untested stages; provider success alone is not full resumable activation.
