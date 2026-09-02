# AYIN Admin launch validation matrix

This document records the control surfaces covered by the launch-hardening branch and intentionally contains no production credentials or environment-specific secrets.

## Admin control surfaces

- Role-aware Admin dashboard and navigation.
- Operations, audit log, support assignment, scoped staff directories and creator compliance.
- Content Library with rights-aware catalog workflows.
- Moderation and Trust & Safety operations.
- Advertising control center for placements, advertisers, direct campaigns, creatives, authorized-seller files, GAM diagnostics, page ads and the emergency kill switch.
- In-player video ad defaults plus searchable channel/video overrides and reset-to-global behavior.
- Revenue control center for creator lookup, contracts, imports, append-only adjustments, payouts, disputes and paginated ledger inspection.

## Required launch quality gates

The hardening branch is not considered ready until the repository `Task quality gates` workflow succeeds for the exact branch head. The workflow validates dependency audit policy, Prettier formatting, deployment tooling, lint, TypeScript/Prisma generation, unit/schema tests, clean PostgreSQL migrations and integration tests, and production builds.
