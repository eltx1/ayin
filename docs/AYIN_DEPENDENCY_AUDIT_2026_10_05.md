# Production dependency audit correction, October 5, 2026

## Scope

The production audit on main `c8234f8897d029860ab4d7e6f82c202ed4b1d8eb` reported one moderate advisory and no high/critical findings. The configured high-severity security gate correctly passed; that result did not mean the dependency graph had no advisories.

The affected package was optional `mysql2` 3.22.0 through `packages/db → @prisma/client → prisma → mysql2`. AYIN's actual Prisma datasource is PostgreSQL and application source does not instantiate a compressed MySQL connection. No claim about arbitrary external consumer configurations is made.

The focused correction changes the existing override to mysql2 3.23.1 and regenerates its lockfile entries and registry integrity. It does not upgrade Prisma, change the database provider, alter credentials, change audit thresholds or suppress an advisory.

## Verified upstream evidence

Checked October 5, 2026:

- [Maintainer advisory GHSA-rgwj-5xj2-c3m3](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-rgwj-5xj2-c3m3) describes unbounded decompression when compression is enabled against a malicious or compromised MySQL endpoint.
- [Maintainer 3.23.1 release](https://github.com/sidorares/node-mysql2/releases/tag/v3.23.1) explicitly includes the bounded-decompression correction. The installed registry package's compressed protocol handler passes the advertised uncompressed length as `maxOutputLength` to zlib.
- [Reviewed advisory record](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) and the actual package audit identify 3.23.1 as patched. The maintainer advisory's standalone patched-version field still says none; the release/source and reviewed record establish the shipped fix rather than silently treating that stale field as authoritative.

## Validation and remaining gates

Frozen installation succeeded with pnpm 11.24.0. The actual corrected production audit returns zero advisories across all severity levels in the current registry response. This is point-in-time dependency evidence, not a claim that the product has no security defects.

Root formatting, lint, typecheck, all unit suites (including 421 API and 558 Web cases), workspace package builds and API/Web production builds passed. A small direct regression exercised the actual installed compression handler without a network server: the 3.22.0 baseline accepted 1,024 decompressed bytes despite an advertised length of 16; 3.23.1 rejected the same input with ERR_BUFFER_TOO_LARGE; a valid 16-byte input still passed. No large-memory attack was executed.

Integration/browser CI, merge and deployed-SHA verification remain required before runtime acceptance. No application behavior or rendered UI source is changed. Rollback is the focused override/lockfile reversal, which would restore the known moderate advisory and must not be described as a security fix.
