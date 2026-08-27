# AYIN Development Contract

Status: Accepted baseline for Task 00  
Last updated: 2026-08-27

This document defines the local-development and repository conventions that Task 01 and later tasks must preserve. Commands marked “reserved” are part of the intended command surface and should be added when the owning capability exists; Task 00 does not scaffold or run them.

## 1. Current repository baseline

At the end of Task 00 the repository remains documentation-only. Application code, dependency manifests, lockfiles, generated clients, migrations, and environment files do not yet exist.

| Existing area | Purpose |
| --- | --- |
| `README.md` | Product and repository entry point |
| `docs/AYIN_MASTER_PLAN.md` | Authoritative product/platform plan |
| `docs/AYIN_AI_AGENT_RULES.md` | Mandatory implementation and reporting rules |
| `docs/AYIN_EXECUTION_ROADMAP.md` | Sequential task scope and acceptance criteria |
| `docs/ARCHITECTURE.md` | Engineering boundaries and runtime/data-flow contract |
| `docs/DEVELOPMENT.md` | Local workflow and conventions |
| `docs/DECISIONS.md` | Accepted architectural decisions |

No repository evidence conflicts with NestJS/Fastify or Prisma, so those are the accepted baseline.

## 2. Local prerequisites

Task 01 must pin exact tool versions in repository-owned files. Until then, use:

- Git.
- A current active-LTS Node.js release supported by the selected stable Next.js, NestJS, Prisma, and pnpm versions.
- Corepack enabled.
- pnpm, with the exact version later pinned in the root `packageManager` field and lockfile.
- PostgreSQL for database tasks beginning with Task 02. A local instance or disposable container is acceptable.
- Docker/Compose may be offered as a convenience for local infrastructure, but must not be the only supported way to run the TypeScript applications.

Do not install production credentials locally merely to make a test pass. Provider-dependent features must use explicit development adapters or skip with an honest message when their roadmap task introduces them.

## 3. Workspace contract

- Package manager: pnpm only. Do not commit npm, Yarn, or Bun lockfiles.
- Workspace applications: `apps/web` and `apps/api`.
- Shared code: scoped packages under `packages/*` with narrow public exports.
- Language: strict TypeScript for applications, packages, tests, scripts, and configuration whenever the tool supports TypeScript.
- Web: current-stable Next.js App Router selected during Task 01 and pinned by the lockfile.
- API: NestJS with the Fastify adapter.
- Database: PostgreSQL through Prisma in `packages/db`.
- Runtime schemas: Zod where shared contracts, environment values, request/event payloads, or other untrusted inputs need runtime validation.
- Architecture: one modular monolith. Do not add service-to-service networking, independent databases, or message brokers without a later task and ADR.

Applications may depend on packages. Packages must not depend on an application, and one application must not import the other's source tree.

## 4. Root command surface

Task 01 must provide the applicable root commands and keep their behavior stable. Later tasks add reserved commands only when the capability exists; do not create misleading no-op scripts.

| Command | Required behavior |
| --- | --- |
| `pnpm install --frozen-lockfile` | Reproduce dependencies in CI after the initial lockfile exists |
| `pnpm dev` | Run the normal local web and API development processes together |
| `pnpm dev:web` | Run only `apps/web` |
| `pnpm dev:api` | Run only `apps/api` |
| `pnpm lint` | Lint every relevant workspace project |
| `pnpm format` | Apply the repository formatter |
| `pnpm format:check` | Verify formatting without modifying files |
| `pnpm typecheck` | Type-check every relevant workspace project without emitting artifacts |
| `pnpm test` | Run the normal unit/test suite deterministically |
| `pnpm test:integration` | Reserved for integration tests when introduced |
| `pnpm build` | Produce production builds for all deployable applications/packages |
| `pnpm db:generate` | Reserved for deterministic Prisma client generation |
| `pnpm db:migrate` | Reserved for local forward migration development |
| `pnpm db:migrate:deploy` | Reserved for applying committed migrations outside development |
| `pnpm db:seed` | Reserved for safe minimal system defaults; never fake production content |

Filtering a workspace for diagnosis is allowed, but the root quality commands remain the final acceptance gate. CI uses frozen installs and must not mutate the lockfile.

## 5. Local defaults and domains

Unless Task 01 discovers a conflict, use these development defaults:

| Surface | Local default | Production-facing name |
| --- | --- | --- |
| Web/PWA, including `/studio` and `/admin` | `http://localhost:3000` | `https://ayin.stream` |
| API | `http://localhost:3001` | `https://api.ayin.stream` |
| Creator Studio route | `http://localhost:3000/studio` | `/studio` initially; `studio.ayin.stream` may route to it later |
| Admin route | `http://localhost:3000/admin` | `/admin` initially; `admin.ayin.stream` may route to it later |
| Media delivery | Explicit local adapter URL when implemented | `https://media.ayin.stream` |
| Advertising service | Local API module/adapter when implemented | `https://ads.ayin.stream` only when a distinct public endpoint is required |

Port values are development defaults, not business configuration. They may be overridden with documented environment variables.

## 6. Environment naming conventions

### Environment classes

Use a typed application environment value with exactly these names unless a framework value must also be set:

- `local`
- `test`
- `staging`
- `production`

`NODE_ENV` retains its ecosystem meaning (`development`, `test`, or `production`). If a separate deployment selector is required, use `APP_ENV`; do not overload `NODE_ENV` with `staging`.

### Files

- Commit `.env.example` files containing names, comments, and non-secret placeholders only.
- Keep actual `.env`, `.env.local`, `.env.*.local`, and production secret files untracked.
- Prefer app-specific examples such as `apps/web/.env.example` and `apps/api/.env.example` when ownership differs.
- A root environment example is acceptable only for shared development orchestration.
- Tests use explicit test configuration and disposable resources; they must never fall back to a production database or R2 bucket.

### Variable names

- Use uppercase `SCREAMING_SNAKE_CASE`.
- Browser-exposed Next.js values must use `NEXT_PUBLIC_` and be proven non-secret.
- Server-only database, session, R2, OAuth, email, and ad-provider credentials must never use `NEXT_PUBLIC_`.
- Use positive, specific names such as `DATABASE_URL`, `MEDIA_PUBLIC_BASE_URL`, or `R2_BUCKET_NAME`; avoid vague names such as `KEY`, `URL`, or `SECRET` without a provider/purpose prefix.
- Distinguish identifiers from secrets: for example, an account or bucket identifier is not named as a secret, while an access key secret is.
- Validate required environment variables at process startup with typed schemas. Fail clearly in production; development adapters must be explicitly selected rather than silently activated.

Illustrative names below define naming style, not credentials or a final exhaustive schema:

```dotenv
APP_ENV=local
WEB_ORIGIN=http://localhost:3000
API_ORIGIN=http://localhost:3001
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
MEDIA_PUBLIC_BASE_URL=https://media.example.invalid
R2_ACCOUNT_ID=replace-with-account-id
R2_BUCKET_NAME=replace-with-bucket-name
R2_ACCESS_KEY_ID=replace-with-access-key-id
R2_SECRET_ACCESS_KEY=replace-with-secret-access-key
```

`.example.invalid` and `replace-with-*` are intentional non-production placeholders. Task 00 creates no real credentials, seller IDs, OAuth IDs, ad tags, or connection strings.

## 7. TypeScript and module conventions

- Enable strict TypeScript settings. Framework-specific exceptions must be narrow, commented, and justified.
- Prefer named exports for shared modules and explicit package public APIs.
- Avoid default barrels that accidentally expose internals or create dependency cycles.
- Use configured workspace aliases rather than long relative imports across package boundaries.
- Keep domain names consistent with the master plan: `ViewerProfile`, `Channel`, `Playlist`, `CreatorTvChannel`, `Video`, and related stable concepts.
- Use stable IDs for relationships; do not use mutable handles or display names as foreign keys.
- Avoid `any`. At external boundaries receive `unknown`, validate, and narrow it.
- Keep generated code out of manual edits and ensure generated/build output is ignored unless a tool explicitly requires a checked-in artifact.

## 8. Validation and API conventions

- Validate every untrusted API input on the server, even if the web client already validated it.
- Use Zod for genuinely shared runtime schemas and for environment/event/provider boundary validation where useful.
- Keep NestJS transport DTOs/mappers at the API boundary; domain services must not depend on Fastify request/reply objects.
- Use one documented error envelope and stable machine-readable error codes once the API is scaffolded.
- Validate pagination and cap list limits.
- Derive ownership and roles from authenticated server context, never client-supplied account/channel ownership fields.
- Version externally durable event contracts. Avoid versioning internal APIs preemptively when additive evolution is sufficient.
- Do not expose Prisma models or provider SDK objects directly as public API contracts.

## 9. Domain and data conventions

- Prisma schema, migrations, and client construction live in `packages/db`.
- Schema changes use deterministic forward migrations. Never use ad hoc production schema edits.
- Multi-record invariants use transactions, especially registration auto-provisioning.
- Successful registration must atomically create the account, default viewer profile, public channel, unique handle, protected Uploads playlist, and Creator TV. Default settings/monetization records are included as the schema introduces them.
- Published uploads are associated exactly once with Uploads and, when configured, Creator TV.
- Video records store metadata and R2 object references only. PostgreSQL must never contain video binary/blob data.
- Money uses decimal-safe database/application types, never binary floating point.
- Important destructive states should prefer explicit status/soft-delete and audited recovery over immediate physical deletion where feasible.

## 10. Media development rules

- The only production upload path is **Creator browser -> Cloudflare R2** using short-lived, server-authorized direct upload.
- Neither `apps/web` nor `apps/api` may expose an endpoint that accepts/proxies creator video bodies.
- Local development must use a documented media adapter introduced in the media task. It must be unmistakably non-production and must not falsely report R2 connectivity.
- R2 keys are server-generated from stable IDs; raw filenames do not determine object keys.
- V1 accepts playback-ready MP4 and does not introduce transcoding.
- Tests use small fixtures outside normal source paths and must not commit large generated media artifacts.

## 11. Advertising development rules

Treat these as separate inventory families from schema through UI:

1. In-player video inventory: pre/mid/post, VAST/IMA, player ad state, and video-ad events.
2. Outside-player display/native inventory: logical page placement keys, responsive rendering, GPT-ready adapters, and page-ad events.

Provider tags and credentials belong in validated configuration/adapters, not React components. Tests and local adapters must not claim real Google fill. An ad failure must degrade safely: resume content for video inventory and collapse no-fill page slots.

## 12. Web, PWA and TV conventions

- Use the Next.js App Router; do not add a parallel Pages Router.
- Keep viewer, Studio, and Admin code in isolated route/module trees with independently enforced access rules.
- Quick Upload remains available outside Studio when implemented.
- Build accessible shared UI primitives before duplicating patterns.
- Interactive components must support their relevant pointer, touch, keyboard, and directional-focus behavior.
- TV focus state and remote key mapping belong in reusable primitives/adapters.
- Service workers may cache application shell/static assets and explicitly safe reads, but never indiscriminately cache the creator video library.
- Platform shells consume web capabilities through adapters and must not fork ordinary product/business logic.

## 13. External provider convention

- Define an AYIN-owned interface in the relevant module.
- Keep provider SDK imports inside infrastructure adapter implementations.
- Translate provider data/errors into AYIN-owned types and error codes.
- Select adapters through typed configuration and dependency injection.
- Provide honest health/status reporting.
- Never silently fall back from a failed production provider to a fake-success adapter.
- Keep permanent provider credentials server-side and redact them from logs and admin responses.

## 14. Testing and quality gates

Each task must run every configured relevant gate and report the exact outcome:

1. Formatting check or formatter.
2. Lint.
3. Type checking.
4. Relevant unit/integration tests.
5. Production build for affected apps when practical.
6. `git diff --check` and a review for secrets/large generated artifacts.

Tests should emphasize behavior and invariants: provisioning, authorization, upload signing/state, Creator TV, settings, ads, revenue, and destructive admin actions. Framework snapshot churn is not a substitute for domain tests.

Task 00 has no application toolchain, so only documentation and repository checks can run. This is expected and must be reported honestly.

## 15. Change discipline

- Read the master plan, AI rules, current roadmap task, architecture docs, and relevant current code before every task.
- Execute one roadmap task only and stop at its acceptance boundary.
- Do not mix opportunistic refactors or the next task into the current change.
- Never commit secrets, production credentials, private keys, real ad seller IDs, or large generated/build artifacts.
- Update `docs/DECISIONS.md` when an architectural decision changes; do not rewrite history silently.
- Keep documentation synchronized with commands and environment names actually implemented.
