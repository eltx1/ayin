# Performance, accessibility and TV usability pass

Task 28 reviewed the implemented V1 paths rather than optimizing synthetic placeholders.

## Changes made

- Safe anonymous catalog GETs now receive short shared-cache headers with stale-while-revalidate. Authenticated, mutation and non-catalog responses remain `no-store`.
- Discovery rows use `content-visibility: auto` with an intrinsic fallback size so long home feeds avoid unnecessary offscreen rendering work while preserving normal DOM semantics and pagination.
- Discovery artwork now uses explicit aspect-ratio containers and `next/image` lazy loading with responsive size hints. R2/media URLs remain external delivery URLs and are not proxied through the app server.
- Existing MP4 playback already used `preload="metadata"`, progressive HTTP media delivery and bounded 15-second progress checkpoints; those behaviors were retained because they avoid downloading full media before intent and avoid per-timeupdate writes.
- Discovery carousels gained labelled regions, keyboard page scrolling, busy/live loading feedback and stronger media-card accessible names.
- Existing global focus-visible and TV focus styling, large-screen focus rings, safe-area handling and reduced-motion rules were retained. Skeleton/card motion is now also explicitly disabled for reduced-motion users.

## Query and pagination review

Discovery rows remain cursor-paginated and bounded by API limits rather than rendering unbounded result sets. The service uses Prisma query builders and the V1 schema already indexes the primary catalog/state/relationship paths introduced by earlier tasks. Task 28 did not add speculative duplicate indexes without query-plan evidence.

## Measurement boundaries

Repository CI verifies build correctness, types and tests but does not provide a production network/R2/browser lab. Before launch, measure Core Web Vitals and MP4 startup on the deployed Cloudflare/R2 domains with representative mobile, desktop and TV hardware. Any optimization based on those measurements should preserve the caching/privacy boundaries documented here.

## TV and accessibility acceptance

Keyboard/remote focus must remain visibly indicated; horizontal rows expose deterministic focusable controls/cards and do not trap focus. Player controls keep labels and keyboard shortcuts. Screen-reader content uses semantic headings/sections and loading/error status announcements. Reduced-motion preference removes nonessential scrolling/skeleton/card transitions.
