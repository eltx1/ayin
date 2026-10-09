# Fixed continuation of the retained owned-fixture attempt

Status: reviewed source and offline tests are separate from live acceptance. This tooling never enables recovery issuance or certifies an application upload flow.

The original attempt remains FAILED/STDIO_PROTOCOL_FAILED. Its small.bin allocation was created, aborted and observed absent; it did not complete a single-part upload. Preserve that original journal unchanged. The continuation accepts only its pinned SHA256 `c53016b757a13409abaebc0063779f2eae4722ca59fd692e9c67562471e2df6f`, exact state, original deployed release and recorded dispatch timestamp. No caller-supplied predecessor digest is accepted.

## Fixed remaining work

The existing approved prefix and three-key scope do not change. Only two remaining CREATE calls are possible, bringing the combined maximum to three including the failed original attempt:

1. multipart.bin: initiate once; sign part 1 for 38 bytes and send exactly 39 synthetic bytes through the bounded, single-use direct provider probe. Require HTTP 403 SignatureDoesNotMatch and authoritative empty ListParts. Then upload 5 MiB through the real AYIN browser origin, verify inventory, recreate the browser context and upload the remaining 17 bytes. Complete with authoritative provider parts, discard the acknowledged receipt, and independently verify binding, metadata, full SHA256 and AYIN root through direct readback.
2. abort.bin: initiate once; upload 5 MiB through the real browser, verify provider inventory, then abort the known allocation and observe absence.

The direct negative probe does not establish browser visibility of the provider's error response. Positive PUTs and resume still require actual browser request/response observation. The original failed small.bin result is not converted into success, and single-part completion remains outside this continuation's coverage.

## Immutable predecessor and exclusive continuation

The original journal is read with a bounded O_NOFOLLOW file descriptor and owner, mode, size, state and digest checks. Fresh exact-key and known-allocation absence is required after a conservative 90-second cutoff derived from the original final dispatch timestamp.

The fixed new filename is `34c4947c-ba13-4fc9-9087-0d1db8cc4d28.remaining-fixtures-v1.json`, in the existing private manifest directory. The same durable reservation helper checks parent/directory ownership, fsyncs the parent and reserves with O_EXCL; it never opens an existing reservation for continuation. Every dispatch and each emitted grant's expiry is journaled before exposure or I/O. Interrupted, failed and successful journals remain permanently reserved.

Known cleanup uses the existing shared owned-fixture implementation. Unknown CREATE IDs are not guessed; unknown Complete is not replayed, aborted or deleted; unknown abort/deletion is not retried. Fresh absence cannot clear such debt. Success additionally waits beyond every newly issued grant's recorded expiry, then rechecks all three exact keys and known allocations. Failed cutoff or final observation retains failure and uncertainty. This finite observation does not promise eternal absence or replay-proof provider URLs.

## Separate source tooling and deployed adapters

The application remains at exact release `a6c15842bd2cf6990715f18d58a550a5929d8d41`. The continuation runtime resolves only `/home/ayin/htdocs/current`, verifies the exact clean Git release and cwd, and imports compiled adapters through file URLs anchored to that release.

The separately reviewed one-time invocation stages only these files in a new private, ayin-owned `/home/ayin/.r2-acceptance-tooling/<toolingSha>` directory using the existing pinned SSH identity:

- r2-owned-fixture-provider.mjs
- r2-owned-continuation-provider.mjs
- tooling-manifest.json, containing toolingSha, providerSha256 and continuationSha256

Directory creation, source copying and exact SHA256 checks precede execution. The directory and files must be private, owned, regular and not symlinks. Run the staged provider through the existing deployed run-with-env.cjs with cwd at the active release. Credentials remain in place. Temporary source cleanup is limited to the three recorded files followed by rmdir, with refusal on unexpected entries or changed ownership/identity. Neither manifest is part of source cleanup. Staging/invocation requires its own exact reviewed workflow and is not performed by the browser driver.

The browser driver requires both normal exact-scope approval and `--execute-continuation-approved`, plus exact release and tooling SHAs. Its proof checks the expected hashes of both staged provider files. The reconstructed artifact binds those hashes, both SHAs, predecessor digest, fixed continuation ID, remaining fixture states and post-cutoff observations. Private upload IDs, grants, credentials, raw headers/bodies and user metadata never become artifacts.

## Offline checks

Run:

```sh
node --test deploy/media/r2-owned-fixture-provider.test.mjs deploy/media/r2-owned-fixture-browser.test.mjs deploy/media/r2-owned-continuation-browser.test.mjs
```

Existing tests retain the original acceptance behavior. Continuation tests use synthetic predecessor records and an injected read-only fixture reader; separate tests verify that the production reader rejects nonmatching bytes and symlinks. Tests cover exactly two remaining CREATEs, direct-negative scope and one-use behavior, three positive browser grants and context recreation, interruption/replay refusal, unknown debt, cutoff failure, tool hash binding and redaction. They do not execute R2 or copy the original private journal off the host.
