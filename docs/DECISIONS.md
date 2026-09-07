# AYIN Architecture Decision Records

Status: Accepted decisions through Task 39  
Decision date baseline: 2026-08-27

These ADRs establish the implementation contract. A later change must add a superseding ADR with its reason and migration impact rather than silently editing an accepted decision.

## ADR-001 — Global Web/PWA source of truth

**Status:** Accepted

**Context:** AYIN must ship quickly across desktop, mobile, and 10-foot/TV surfaces without duplicating ordinary product behavior.

**Decision:** The responsive Web/PWA is the source of truth. AYIN has no country-specific product identity or default assumption. Future mobile and TV shells reuse the hosted web product and platform adapters wherever technically appropriate.

**Consequences:** Normal web/configuration changes can propagate without store releases. Native permissions, SDKs, bridges, and store metadata may still require shell releases. Platform-specific code must not fork ordinary business logic.

## ADR-002 — TypeScript pnpm workspace monorepo

**Status:** Accepted

**Context:** Web, API, shared UI, configuration, contracts, and infrastructure boundaries benefit from one versioned repository and consistent quality gates.

**Decision:** Use TypeScript throughout a pnpm workspace monorepo with applications in `apps/*` and shared packages in `packages/*`.

**Consequences:** pnpm is the only package manager, exact tooling is pinned in Task 01, and apps cannot import each other's private source. Shared code requires a clear package boundary rather than copy/paste.

## ADR-003 — Next.js current-stable App Router for `apps/web`

**Status:** Accepted

**Context:** AYIN needs a responsive, SEO-capable, PWA-ready React application with viewer, Creator Studio, and Admin surfaces.

**Decision:** Build `apps/web` with the current stable Next.js release available at Task 01 scaffolding time, use the App Router, and pin the resolved version in the lockfile.

**Consequences:** Do not create a parallel Pages Router. Browser-only capabilities stay in client boundaries, while domain mutations remain owned by the API.

## ADR-004 — NestJS with Fastify for `apps/api`

**Status:** Accepted

**Context:** AYIN needs explicit modules, dependency injection, guards, validation, and a structured API without starting as microservices. The audited greenfield repository contains no conflicting constraint.

**Decision:** Build `apps/api` as a NestJS application using the Fastify adapter.

**Consequences:** Nest modules express domain boundaries; Fastify is transport infrastructure. Domain services do not depend on Fastify request/reply objects, and adapter-specific types do not leak across boundaries.

## ADR-005 — PostgreSQL with Prisma

**Status:** Accepted

**Context:** AYIN's identity, catalog, social, schedule, advertising, settings, and financial records are relational and transaction-heavy. The repository contains no ORM constraint.

**Decision:** PostgreSQL is the transactional system of record. Prisma owns schema mapping, generated access, and deterministic forward migrations in `packages/db`.

**Consequences:** Registration provisioning and other multi-record invariants use transactions. Stable IDs back relationships. Video binary/blob data is prohibited in the database.

## ADR-006 — Zod at runtime boundaries

**Status:** Accepted

**Context:** TypeScript types disappear at runtime and cannot validate browser, API, environment, provider, or event input.

**Decision:** Use Zod where shared runtime validation is useful, especially for environment configuration, shared request/event contracts, and provider inputs. Server-side validation remains mandatory even when the client validates.

**Consequences:** Avoid duplicate schemas where a safe shared schema is appropriate, but do not force domain internals to depend on transport schemas or use Zod ceremonially for already trusted values.

## ADR-007 — Modular monolith first

**Status:** Accepted

**Context:** AYIN has many domains but initially one product team and one operational deployment environment. Microservices would add distributed failure and coordination cost before evidence supports them.

**Decision:** Implement a modular monolith with explicit domain modules and typed boundaries. Background workers may be separate processes while remaining in the same application/code boundary.

**Consequences:** No independent per-module databases or internal network APIs by default. A service extraction requires measured operational need and a new ADR.

## ADR-008 — Direct-to-R2 creator video storage

**Status:** Accepted; processing details superseded by ADR-015

**Context:** Creator uploads may be large, and the master plan prohibits AYIN video storage on AWS application infrastructure.

**Decision:** Cloudflare R2 is the only durable AYIN creator video object store. The upload path is **Creator browser -> Cloudflare R2 directly**, using short-lived authorization issued after server-side ownership/quota checks. Web/API request handlers do not receive or proxy creator upload bodies.

**Consequences:** The API stores metadata and R2 references. Upload sessions, multipart completion, cleanup, and delivery use AYIN-owned media infrastructure. ADR-015 supersedes the original V1 assumption that no processing worker or temporary local media scratch exists.

## ADR-009 — Studio and Admin share the initial web deployment

**Status:** Accepted

**Context:** Separate deployments would add operational cost before scale requires them, while security and code ownership still need clear separation.

**Decision:** Creator Studio and Admin initially live in isolated `/studio` and `/admin` route groups/modules within `apps/web`. They consume the same authoritative API and may be exposed through dedicated hostnames later.

**Consequences:** Bundles, navigation, guards, and modules remain separable. Admin authorization is independently enforced by the API; hiding routes or UI is never considered authorization.

## ADR-010 — PWA and TV focus are first-class

**Status:** Accepted

**Context:** AYIN must work as an installable web product and remain usable with a TV remote on a 10-foot display.

**Decision:** PWA lifecycle, deep-link behavior, responsive design, and reusable directional focus/remote abstractions are designed from the first web foundation task.

**Consequences:** Pointer-only components and page-specific focus patches are unacceptable. Service-worker strategy must not indiscriminately cache creator video media.

## ADR-011 — External providers use adapters

**Status:** Accepted

**Context:** Storage, identity, email, advertising, analytics, and future live/search/payment vendors can change and may be unavailable in development.

**Decision:** Domain/application code depends on narrow AYIN-owned interfaces. Provider SDKs, credentials, response models, and error translation stay inside infrastructure adapters selected through typed configuration.

**Consequences:** Development adapters must be explicit and honest. Missing production configuration cannot be represented as a successful connection, and provider types cannot become core domain types.

## ADR-012 — Registration atomically provisions the creator identity

**Status:** Accepted

**Context:** AYIN's differentiator is that every registered user is immediately a viewer and creator without an application or setup wizard.

**Decision:** A successful registration transaction automatically creates the account, default viewer profile, public creator channel and handle, protected Uploads playlist, and Creator TV. It also creates the applicable default channel, monetization, notification, and analytics records as those schemas are introduced.

**Consequences:** A successful account cannot be partially provisioned. Provisioning must be atomic, idempotent/recoverable, and tested. The default creator workflow remains simple and advanced controls stay optional.

## ADR-013 — Separate advertising inventory families

**Status:** Accepted

**Context:** Ads rendered inside a video player have different protocols, lifecycle, UX, measurement, and failure behavior from ads placed around web content.

**Decision:** Model two inventory families: (1) in-player video inventory for pre/mid/post using a VAST/IMA-ready video-ad boundary, and (2) outside-player display/native inventory using logical page placement keys and a GPT-ready page-ad boundary.

**Consequences:** The families may share campaign administration, consent, attribution, and analytics, but not raw tags, placement records, or rendering components. Video ad failure resumes content; page no-fill collapses safely.

## ADR-014 — Admin-configurable business behavior

**Status:** Accepted

**Context:** AYIN's owner must control operational behavior without repeated code deployments, while secrets and dangerous controls must remain protected.

**Decision:** Revenue share, upload limits, creator defaults, homepage/navigation, ad policy, moderation defaults, and feature availability use typed platform settings and audited Admin controls where reasonably safe.

**Consequences:** Business values must not be scattered constants. Secrets remain server-side environment configuration, high-impact changes require authorization/audit, and Admin is not raw server access.

## ADR-015 — Adaptive media architecture with canonical MP4 fallback

**Status:** Accepted in Task 39 (2026-09-07)

**Context:** The repository has evolved beyond the original playback-ready-MP4 assumption. AYIN now has a real database-backed media queue, a separate worker process inside the modular application boundary, `ffprobe`, FFmpeg canonicalization to H.264/AAC `yuv420p` fast-start MP4, R2 upload/verification, lease recovery, retry/backoff, and deterministic per-video processing generations. Public playback, however, still exposes and plays a single validated MP4. A single progressive object is inefficient and fragile across variable network conditions and TV/browser environments, while changing the working production path in the same step would create unnecessary rollout risk.

**Decision:** AYIN will evolve to HLS adaptive bitrate streaming while retaining the canonical progressive MP4 as a mandatory fallback. The initial production ladder is 360p/480p/720p/1080p using H.264 video, AAC audio and `yuv420p`; a rendition is created only when the normalized source display resolution justifies it, so AYIN never upscales. 1440p/4K are not initial production outputs. Task 39 defines contracts, durable generation/rendition state and deterministic storage namespaces only; it does not generate HLS or switch playback.

The existing modular-monolith/worker boundary remains the home of media processing. No transcoding microservice is introduced. The existing canonical key remains:

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}.mp4
```

Adaptive objects for the same generation use:

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/master.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/{rendition}/index.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/{rendition}/segment-000001.ts
```

Only planned rendition identities receive objects. A retry of the same generation reuses the same namespace; an intentional reprocess gets the next generation.

**Failure/retry semantics:** R2 object existence is never readiness. A V2 generation may be marked adaptive `READY` only when the fallback MP4, HLS master manifest and every planned rendition are individually `READY` after upload/verification. Partial output remains non-ready and invisible to adaptive selection. Existing queue leases, heartbeats, bounded retry/backoff and stale-lease recovery remain the processing foundation. Deterministic keys permit idempotent HEAD/probe/verify reuse. Failed attempts do not create a new generation; explicit reprocess does.

**Why retain MP4:** It is the known-working production path, supports instant rollback, covers sources for which no adaptive rung is justified, and prevents HLS packaging/player problems from making existing videos unplayable.

**Why stay in the modular monolith/worker boundary:** The current worker already isolates CPU-heavy work operationally without introducing network/service coordination. No measured scaling or team-ownership requirement justifies a media microservice yet. A later service extraction requires evidence and a separate ADR.

**Rollout:** (1) Task 39 contracts/schema only; (2) generate and verify V2 outputs behind a default-off capability; (3) observe production output correctness while the player remains MP4; (4) expose adaptive metadata without preferring it; (5) enable adaptive player selection separately with automatic/manual MP4 fallback; (6) retain old generations until cleanup policy and rollback windows are proven.

**Consequences:** The processing worker may use bounded ephemeral local scratch for probe/transcode/package work, but R2 remains the only durable creator video object store and upload request bodies still bypass web/API servers. PostgreSQL stores metadata/lifecycle state, never media bytes. The `MediaAsset`/watch/player V1 contract remains untouched in Task 39. See `docs/MEDIA_ARCHITECTURE_V2.md` for the detailed contract and drift audit.
