# Fast URI dependency remediation

## Scope and verified inputs

This security gate recovery is part of PR #142, not a waiver of its final acceptance. The reviewed two-file patch upgrades the existing Fastify/Ajv transitive copies from fast-uri 3.1.6 to 3.1.8 and 4.1.3 to 4.1.5 with range-specific overrides. No unrelated dependency, API authorization, audit threshold, minimum release age or integrity policy is changed.

The exact patch is `docs/security/fast-uri-remediation.patch`, SHA-256 `d5366013554ea81e1c43d058e444dc308aa022b6e8f6fe6c19d96806b2e38e9f`. Package-manager preview run `36498826181` produced digest-verified artifact `11003744073`; frozen installation, production high-severity audit and all ten runtime URI regression tests passed. One moderate advisory remained. Those results apply to the preview, not to an untested later commit or production.

Reviewed upstream releases and malformed-host/component-serialization fixtures are recorded in the master checkpoint. The tests resolve the actual transitive copies rather than adding a direct runtime dependency.

## Publication on 2026-09-29

The user explicitly confirmed use of the connected GitHub and GitHub Actions for continuing the task. Workflow run `36501428878`, job `109192928895`, on source `21a068f02c6faa2b5a3f87be1206eb044bcaa3dd` succeeded. It validated the existing input blob hashes, verified the patch SHA-256, applied it only in the job workspace, required exactly two changed paths, and validated both output Git hashes. It stored only those two Git blobs through the normal GitHub API; it did not change any branch, merge, deploy, retrieve server secrets or touch Cloudflare. Checkout credentials were not persisted.

A normal connector-created tree/commit adopts the two stored blobs on the existing review branch. The temporary blob-publication workflow is removed in the same change. No persistent branch-writing automation is introduced. This resolves the earlier publication limitation recorded in the checkpoint; no additional desktop connection is required.

Expected adopted file identities:

- `pnpm-lock.yaml`: Git blob `c612a9d083eda41c1a2091d2eb4ebeaef19310fc`; 227910 bytes; SHA-256 `1efb634ebc9b755cc35e47adb7b5587670a7bbf08c88d1390ffd89e67014cb6c`.
- `pnpm-workspace.yaml`: Git blob `824edc74b90bde62490e56c29ccf97d1e83cafed`; SHA-256 `b223d51f3685104864603550c3c87faec2345202edc584b282f5ea61b5ded881`.

## Acceptance and rollback boundary

Run the complete quality, security/dependency review, runtime regressions, integration/build and browser workflows against the actual final PR head before merging. A green preview or successful blob upload is not final acceptance. Record exact run IDs, review, merged main and actual deployment in the master checkpoint. Preserve this security remediation when independently reverting navigation. No production remediation or zero-vulnerability claim is made by this document.
