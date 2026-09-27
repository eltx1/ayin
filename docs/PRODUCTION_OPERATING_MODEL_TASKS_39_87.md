# AYIN Production Operating Model — Tasks 39–87

This document summarizes AYIN's production engineering model at the end of the current Production Evolution Roadmap. It describes what the repository can operate today and separates engineering gaps from external/business dependencies.

## Evolution from Task 39 through Task 87

### Tasks 39–42 — adaptive media foundation

- Task 39 defined Media Architecture V2 contracts for HLS/ABR.
- Task 40 added feature-gated multi-rendition HLS processing.
- Task 41 added HLS ABR playback with deterministic MP4 fallback.
- Task 42 added controlled rollout/backfill so adaptive media could be introduced without rewriting V1 product UI.

The operating rule remains: canonical media and playback state are durable database/object-storage facts; rollout flags can disable adaptive behavior without deleting source truth.

### Tasks 43–50 — production safety and account security

- Task 43 created provider-neutral observability and health semantics.
- Task 44 added encrypted, remotely verified PostgreSQL backup/restore tooling.
- Task 45 added independent read-only synthetic production monitoring.
- Task 46 added guarded local/staging capacity tooling without publishing an unmeasured RPS claim.
- Task 47 added production-grade Admin MFA.
- Task 48 added secure session management/revocation.
- Task 49 added privacy export and safe account deletion lifecycle.
- Task 50 added automated security scanning gates.

The operating rule is fail-closed for privileged access and truthful for observability: missing external evidence is not reported as success.

### Tasks 51–58 — structured content and catalog operations

- Task 51 expanded creator video metadata.
- Task 52 added captions and chapters.
- Task 53 enforced rights, geography, maturity and Kids boundaries.
- Task 54 expanded creator analytics.
- Tasks 55–57 established Movie, Series and Kids catalog models.
- Task 58 hardened catalog administration.

Content policy remains server-authoritative. Public/search/discovery visibility never bypasses rights/maturity/Kids checks.

### Tasks 59–67 — global discovery, search and recommendations

- Task 59 established internationalization.
- Task 60 added Arabic/RTL product support.
- Task 61 added localized metadata.
- Task 62 added regional discovery.
- Task 63 added the trending engine.
- Tasks 64–65 hardened PostgreSQL-native search and language-aware search.
- Task 66 added recommendation evaluation.
- Task 67 added the AYIN Lens semantic-search boundary with safe fallback.

PostgreSQL lexical/trigram/FTS search remains the required baseline. External semantic/search services are optional, feature-gated additions rather than product dependencies.

### Tasks 68–71 — monetization truth and payout/compliance boundaries

- Task 68 hardened Google Ad Manager production boundaries.
- Task 69 added revenue reconciliation.
- Task 70 added payout-provider boundaries/state handling.
- Task 71 added creator compliance boundaries.

The revenue ledger is financial truth. Provider integrations must not rewrite historical ledger facts. Payout/compliance providers are replaceable adapters, and unavailable providers must not be represented as connected.

### Tasks 72–76 — live, FAST and server-side ad insertion boundaries

- Task 72 documented the live provider decision.
- Task 73 added the live-provider adapter.
- Task 74 hardened live playback/recovery.
- Task 75 established the FAST provider boundary.
- Task 76 established SSAI/Google Ad Manager DAI boundaries.

Live/FAST/DAI production activation remains credential/configuration dependent. AYIN does not invent asset keys, stream IDs or provider state.

### Tasks 77–81 — TV/mobile platform strategy

- Task 77 hardened Android/Google TV.
- Task 78 hardened Samsung Tizen.
- Task 79 hardened LG webOS.
- Task 80 established the native iOS distribution/app path.
- Task 81 established the native tvOS strategy/app path.

Backend API/domain contracts are shared. Platform shells use native playback/focus/lifecycle capabilities where web assumptions are invalid. Repository completion is not the same as store approval or device certification.

### Tasks 82–87 — data/worker/database/operations maturity

- Task 82 added scheduled analytics rollups over retained raw truth.
- Task 83 added privacy-aware cohort/retention aggregates.
- Task 84 created the optional, provider-neutral warehouse export boundary.
- Task 85 made PostgreSQL media workers horizontally safe with fenced leases and worker metadata.
- Task 86 optimized PostgreSQL pooling/query paths and documented staged scaling.
- Task 87 creates the consolidated production operating dashboard and provider-neutral unit-economics model.

## Current production topology

The repository is designed around a modular deployment, not mandatory microservices:

- AYIN Web;
- AYIN API;
- one PostgreSQL primary;
- Cloudflare R2/object storage for media;
- media worker processes using the PostgreSQL queue;
- analytics rollup worker;
- optional warehouse-export worker (disabled adapter by default);
- independent synthetic monitoring;
- native/web TV and mobile clients consuming common API/domain contracts.

This topology can scale vertically and by safe process/worker replication before introducing additional stateful systems.

## PostgreSQL consistency model

The primary remains authoritative for:

- authentication/session/authorization decisions;
- account/profile mutation;
- watch progress read-after-write paths;
- subscriptions/reactions/comments where immediate consistency matters;
- media queue claim/heartbeat/recovery/finalization;
- creator revenue, reconciliation, payout and compliance state;
- Admin writes/audit;
- warehouse checkpoints.

Task 86 defines a future replica stage only for measured, stale-tolerant public/search/historical analytics reads. No replica router exists today.

## Media operating model

Uploads land in durable object storage through the existing controlled upload path. PostgreSQL tracks processing state.

Task 85 workers use:

- PostgreSQL atomic claim transactions;
- unique per-claim fencing tokens;
- lease expiry and heartbeat;
- crash recovery;
- per-worker concurrency limits;
- deterministic output keys;
- graceful drain/abort behavior;
- worker capability/processing-version metadata.

No Redis/Kafka dependency is required by current measured architecture.

## Data and analytics operating model

Raw analytics events remain privacy-sanitized truth through their retention window.

Scheduled rollups/cohorts serve dashboards so interactive requests do not repeatedly scan raw events. Cross-day cohort identity uses existing signed-in profile pseudonyms; anonymous sessions are not stitched into a new persistent identity.

Warehouse export is optional. Versioned incremental batches/checkpoints exist, but no BigQuery/Snowflake vendor is mandatory.

## Reliability and recovery model

The production safety chain is:

1. API/Web health and structured request/error telemetry;
2. PostgreSQL connection/query observability;
3. Task 85 worker lease/queue health;
4. encrypted verified PostgreSQL backups;
5. non-production restore drills;
6. external synthetic monitoring;
7. guarded capacity testing;
8. CI format/lint/type/Prisma/unit/integration/build/E2E/security gates.

A green application health check does not substitute for backup or synthetic evidence.

## Economics model

Revenue facts come only from the ledger and AdEvent/analytics facts.

Operating costs come only from:

- explicit protected manual inputs, or
- a future billing adapter implementing the Task 87 boundary.

AYIN does not manufacture invoices, FX or gross margin.

See `docs/TASK87_OPERATIONS_DASHBOARD.md` for formulas and evidence requirements.

## Scaling stages

### Stage 1 — current

Single optimized primary, bounded connection pools, PostgreSQL-native search, analytics rollups, PostgreSQL worker queue, horizontal media-worker safety.

### Stage 2 — larger primary resources

Increase CPU/RAM/IO only when measured resource pressure remains after query/index tuning.

### Stage 3 — read replica

Add only when read pressure is measured and replica-safe workloads are identified. Auth, finance and queue ownership remain primary-only.

### Stage 4 — specialized stores

External search, analytical stores, caches or queue systems are introduced only when measured PostgreSQL/product limits justify their operational cost.

## Remaining external/business blockers

These are not unresolved repository bugs:

- real production provider credentials/contracts where a feature is intentionally adapter-gated, including GAM/DAI/live/FAST as applicable;
- payout/compliance provider commercial onboarding where external automation is desired;
- Apple/Samsung/LG/Google/Amazon store signing, review, certification and device-account requirements;
- publisher/advertiser rights, content licensing, privacy/compliance and monetization approvals;
- real provider invoices or operator-confirmed actual cost inputs for a real gross-margin view;
- dedicated safe production synthetic watch/media fixtures if the optional playback checks are to move from skipped to active;
- actual production/staging demand needed to establish business capacity targets.

## Remaining engineering gaps

These are deliberate future engineering items, not Task 87 work:

- no provider billing adapters yet; Task 87 manual cost adapter is the truthful default;
- external GitHub synthetic status is not automatically mirrored into the API host; the dashboard supports an optional trusted report path;
- the Task 45 alert adapter has no external delivery provider configured;
- Task 84 has no warehouse vendor adapter because no operational vendor need has been selected;
- no read-replica router exists because Task 86 found no evidence requiring one;
- no published RPS capacity claim exists until the Task 46 guarded baseline is run against an approved local/staging target.

## Roadmap boundary

Task 87 closes the current Production Evolution Roadmap. There is no Task 88 defined by this roadmap.
