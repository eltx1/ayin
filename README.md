# AYIN

AYIN is a global web-first streaming and creator platform owned by Horus Media.

The target product combines premium Netflix-style viewing, a frictionless YouTube-style creator ecosystem, automatic Creator TV, AVOD/CTV advertising and future FAST/live capabilities.

## Current status

Task 01 foundation complete. AYIN now has a buildable pnpm monorepo with a Next.js Web/PWA application, a NestJS/Fastify API, and shared TypeScript packages. Product features begin in later roadmap tasks.

## Product decisions

- Global platform; not tied to any single country.
- Web/PWA is the source of truth.
- Every registered user automatically receives a viewer profile, creator channel, Uploads playlist and Creator TV.
- Creator upload flow is intentionally minimal.
- V1 accepts playback-ready MP4.
- Cloudflare R2 is the only video media storage layer.
- AWS EC2 + CloudPanel host application services; video files are not stored on AWS.
- Advertising is designed from day one for both in-player video inventory and outside-player placements.
- Google IMA / Google Ad Manager readiness is a core requirement.
- Admin is designed as a comprehensive platform control plane.

## Planning documents

- [AYIN Master Product & Platform Plan](docs/AYIN_MASTER_PLAN.md)
- [AI Implementation Rules](docs/AYIN_AI_AGENT_RULES.md)
- [Sequential AI Execution Roadmap](docs/AYIN_EXECUTION_ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development Contract](docs/DEVELOPMENT.md)
- [Architecture Decision Records](docs/DECISIONS.md)

## Execution

Implementation should follow the numbered roadmap tasks one at a time. Each task has a copy-ready AI prompt, acceptance criteria and a defined stop point to minimize agent drift and incomplete multi-feature runs.

## Workspace commands

Prerequisites: Node.js 24 (see `.nvmrc`) and Corepack. From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Quality and production checks:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Run one application with `pnpm dev:web` or `pnpm dev:api`. The web app defaults to `http://localhost:3000`; the API defaults to `http://localhost:3001`, with health available at `GET /health`.
