# Advertising configuration versions

Prepared source: PostgreSQL execution remains required. Existing legacy commands retain compatibility when expectedUpdatedAt is omitted; native commands must submit the actual captured nullable settings/override version.

Settings and per-target overrides serialize creation with transaction advisory locks, then lock actual configuration rows FOR UPDATE. This protects missing defaults as well as stored rows. Current actor authority is rechecked after those waits. Captured null requires no stored record; captured timestamps require an existing matching record. Conflict is 409 with no new configuration or audit effects. Accepted settings/override writes advance updatedAt beyond future stored versions, and configuration/audit effects remain one transaction. Override acknowledgements omit updatedBy/createdAt. DELETE validates its optional captured version and reports actual deletion. Production target foreign keys and their cascade behavior are retained.

Seven prepared real PostgreSQL cases cover superseded missing/stored settings, future settings and actual audit failure rollback/retry, default override creation and safe acknowledgement, future override stale patch/delete, channel/video separation and malformed versions, an observed row-lock winner, and two distinct actors attempting the same captured missing settings. Local checks and exact-source gates must be recorded after actual execution.

This does not complete native EN/AR advertising controls, original-target recovery and cancellation UI, CMP/consent/age/provider acceptance, or the full master. No provider is activated and production advertising settings are not changed by this task.
