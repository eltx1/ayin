# AYIN Architecture Decision Records

Status: Initial accepted decisions for Task 00  
Decision date: 2026-08-27

These short ADRs establish the greenfield implementation contract. A later change must add a superseding ADR with its reason and migration impact rather than silently editing an accepted decision.

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

**Status:** Accepted

**Context:** Creator uploads may be large, and the master plan prohibits AYIN video storage on AWS application infrastructure.

**Decision:** Cloudflare R2 is the only AYIN creator video object store. The required media path is **Creator browser -> Cloudflare R2 directly**, using short-lived authorization issued after server-side ownership/quota checks. AWS EC2/CloudPanel hosts application services and PostgreSQL but never receives, proxies, buffers, stages, or persists creator video bytes.

**Consequences:** The API stores metadata and R2 references only. Upload sessions, multipart completion, cleanup, and delivery use an AYIN media adapter. V1 accepts playback-ready MP4 and introduces no implicit transcoding service.

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
