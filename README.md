# AYIN

AYIN is a global web-first streaming and creator platform owned by Horus Media.

The target product combines premium Netflix-style viewing, a frictionless YouTube-style creator ecosystem, automatic Creator TV, AVOD/CTV advertising and future FAST/live capabilities.

## Current status

The repository-side scope of the complete Tasks 00–38 roadmap is implemented on `main`.
AYIN includes the Web/PWA viewer product, Creator Studio, Admin control plane, direct-to-R2
creator uploads, queued FFmpeg media processing, Creator TV, advertising and revenue foundations,
analytics, moderation, Clips, community posts, recommendations, provider-neutral live/FAST
boundaries, and thin Android/Tizen/webOS shells.

Post-roadmap production hardening now accepts common mobile/camera source containers and normalizes
video through the isolated AYIN media worker to validated canonical MP4 playback media stored in R2.
Publishing and public discovery/playback remain gated on successful canonical-media validation.

Production provider activation and store release checks that require real credentials,
infrastructure, Google Ad Manager account data, signing identities, or physical target devices
remain explicit launch gates rather than simulated repository completion. See
[`TASK_PROGRESS.md`](TASK_PROGRESS.md) and the
[`V1 launch checklist`](docs/LAUNCH_CHECKLIST.md) for the evidence and remaining live checks.

## Product decisions

- Global platform; not tied to any single country.
- Web/PWA is the source of truth.
- Every registered user automatically receives a viewer profile, creator channel, Uploads playlist and Creator TV.
- Creator upload flow is intentionally minimal.
- V1 accepts common mobile/camera video source containers and normalizes them to validated canonical MP4 playback media.
- Creator source uploads go directly to Cloudflare R2; the AYIN EC2 media worker performs queued FFmpeg/ffprobe processing and writes validated playback media back to R2.
- Cloudflare R2 remains the video media storage layer; application services run on AWS EC2 + CloudPanel.
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

The numbered roadmap is complete through Task 38. New work should begin by verifying `main`,
`TASK_PROGRESS.md`, the relevant architecture contract, and the current CI state. Preserve the
same branch → review → CI → merge discipline for maintenance and post-roadmap work.

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
pnpm audit:prod
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Run one application with `pnpm dev:web` or `pnpm dev:api`. The web app defaults to `http://localhost:3000`; the API defaults to `http://localhost:3001`, with health available at `GET /health`.
