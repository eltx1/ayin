# AYIN

AYIN is a global web-first streaming and creator platform owned by Horus Media.

The target product combines premium Netflix-style viewing, a frictionless YouTube-style creator ecosystem, automatic Creator TV, AVOD/CTV advertising and future FAST/live capabilities.

## Current status

Greenfield planning and implementation preparation.

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

## Execution

Implementation should follow the numbered roadmap tasks one at a time. Each task has a copy-ready AI prompt, acceptance criteria and a defined stop point to minimize agent drift and incomplete multi-feature runs.
