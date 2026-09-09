# AYIN security scanning and triage

AYIN uses layered CI security gates for the Node.js, pnpm, Next.js, NestJS,
and TypeScript monorepo. The automation is designed to block reliable,
actionable risk without introducing automatic production dependency upgrades or
unsafe remediation.

## Automated gates

The `Security gates` workflow runs on relevant pull requests, pushes to `main`,
a weekly schedule, and manual dispatch.

- **Dependency review:** pull requests detect changes to dependency manifests,
  the pnpm workspace definition, and the lockfile. When dependency inputs change,
  the job requires a frozen install with lifecycle scripts disabled and a HIGH
  threshold production audit. GitHub's native Dependency Review action was
  evaluated first, but this repository currently has Dependency Graph disabled,
  so the native action cannot run. The local gate remains blocking rather than
  silently skipping dependency validation. Native Dependency Review can replace
  this fallback if Dependency Graph is enabled later.
- **Lockfile integrity:** `pnpm install --frozen-lockfile --ignore-scripts` must
  succeed. The security job does not execute dependency lifecycle scripts.
- **Production dependency audit:** `pnpm audit --prod --audit-level high` blocks
  HIGH and CRITICAL production dependency findings.
- **Secret detection:** changed commits are scanned with a pinned Gitleaks CLI.
  The scanner runs without a GitHub or repository secret, verifies the downloaded
  binary against a pinned checksum manifest digest, redacts findings in logs, and
  creates no secret-scan artifact.
- **CodeQL/SAST:** GitHub CodeQL analyzes JavaScript and TypeScript in `apps`,
  `packages`, and `deploy`. Generated Prisma code and test files are excluded to
  keep the signal focused on production code. The default CodeQL security query
  suite is used instead of broader lower-signal query packs.
- **SBOM:** a minimal CycloneDX 1.6 production dependency SBOM is generated from
  pnpm's installed production graph on every security run. Pull requests keep it
  runner-local; pushes, scheduled runs, and manual runs upload the sanitized SBOM
  for seven days. The generator emits package names and versions only, never
  source file contents, environment variables, registry credentials, repository
  URLs, or dependency installation paths.

Third-party scanner code is not given repository secrets. CodeQL uses only the
built-in, job-scoped GitHub token under the explicit least-privilege permissions
in the workflow. Checkout credentials are not persisted by security jobs.
Actions and external scanner versions are pinned to exact commits or checksummed
release artifacts.

No Dependabot or equivalent auto-merge configuration is added by this task.
Production dependency upgrades remain explicit reviewed changes.

## Failure policy

Reliable gates fail closed for newly introduced secrets, invalid lockfiles, and
HIGH/CRITICAL runtime or production dependency vulnerabilities. Scanner setup,
checksum, or analysis failures also fail because a security gate that did not run
is not considered a pass.

CodeQL findings are uploaded for review, but an untriaged static-analysis result
is not converted into a custom severity-based shell failure. This avoids making
release availability depend on a locally reinterpreted SARIF severity or a known
false positive. Validated HIGH or CRITICAL CodeQL findings must still be patched
or explicitly mitigated before merge or release under the triage process below.

## Triage lifecycle

Every actionable security finding follows this lifecycle:

**OPEN → VALIDATE → PATCH/MITIGATE → VERIFY → CLOSE**

### OPEN

Record the scanner, finding or advisory identifier, affected package/file,
severity, affected runtime surface, and the CI run or pull request where it was
observed. Do not paste credentials or unredacted secret values into issues,
comments, logs, or artifacts.

### VALIDATE

Confirm that the finding affects AYIN and determine whether it is reachable in a
production path. For dependency findings, confirm the resolved pnpm version and
whether the dependency is runtime or development-only. For CodeQL, reproduce or
trace the relevant data/control flow. For secret findings, treat a plausible real
credential as compromised until rotation proves otherwise.

A false-positive decision must be evidence-based and documented. Do not weaken a
global threshold merely to make one alert pass.

### PATCH/MITIGATE

Prefer the smallest safe fix: patch the vulnerable dependency, remove or rotate a
secret, correct the vulnerable code path, or apply a narrowly scoped mitigation.
Do not auto-merge dependency upgrades into production. Temporary exceptions must
identify an owner, reason, scope, and follow-up condition.

### VERIFY

Re-run the failing security gate and the normal AYIN quality gates. Confirm the
specific finding is absent or the mitigation is effective without creating a new
regression. Secret remediation includes rotation/revocation; deleting a leaked
value from the latest commit alone is not sufficient if it remains usable.

### CLOSE

Close only after verification evidence is available. Preserve the advisory or
alert identifier and verification result, but never copy secret values into the
closure record.

## Artifact safety

Secret scanning does not upload a report artifact. CodeQL results are handled by
GitHub code scanning. The SBOM generator explicitly emits only normalized package
names and versions and rejects credential-like output before writing the artifact.
No CI artifact introduced by this task contains environment dumps or application
configuration files.
