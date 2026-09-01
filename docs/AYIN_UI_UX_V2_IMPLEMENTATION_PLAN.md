# AYIN UI/UX V2 — Modern Responsive Product Pass

## Objective

Modernize every AYIN product surface before infrastructure deployment while preserving the approved AYIN logo, brand palette, product behavior, accessibility semantics, and the existing direct-to-R2 playback-ready MP4 architecture.

## Product surfaces

- Viewer: discovery/home, category sections, channels, playlists, community, search, notifications, My AYIN, clips, live, watch/player, upload and state screens.
- Creator Studio: dashboard, content, playlists, channel settings, TV, analytics, comments, community, live, monetization, support and trust/safety.
- Admin Control Center: dashboard, operations, users, channels, videos, TV, moderation, product controls, feature flags, advertising, revenue/payouts, video ads and settings.
- Account surfaces: login, register and session states.
- Shared application surfaces: cards, forms, tables, search, comments, player chrome, upload flows, playlists, Creator TV and PWA prompts.

## Design-system V2 principles

1. **AYIN-first visual language** — deep black/violet surfaces with violet → purple → magenta → coral → orange accents. Remove stale aqua/gold-era decorative colors where they conflict with the approved identity.
2. **Modern depth without visual noise** — layered glass surfaces, restrained gradients, thin borders, soft elevation and localized glow only on focal actions.
3. **Clear hierarchy** — fluid display typography, stronger section rhythm, consistent headings, metadata and status treatments.
4. **Responsive by construction** — fluid gutters, `auto-fit` grids, scroll-safe tables, full-width mobile actions and no fixed desktop-only assumptions.
5. **App-ready touch ergonomics** — controls target at least 44–48px, safe-area awareness, stable `100dvh` shells and horizontal navigation that remains usable on narrow devices.
6. **TV/accessibility continuity** — preserve focus-visible and `data-tv-focusable` behavior, reduced-motion support and keyboard semantics.
7. **Functional stability** — this round changes presentation and interaction affordances only; API contracts, finance logic, media storage and playback architecture remain unchanged.

## Implementation sequence

- Foundation tokens and global responsive primitives.
- Viewer shell, hero, content rows/cards and states.
- Studio application shell, cards, metrics, forms, tables and responsive navigation.
- Admin application shell, command surfaces, finance/operations density and responsive tables.
- Authentication and account surfaces.
- Secondary shared modules: channel, playlists, search, social/comments, upload, player, Creator TV, clips and specialty pages.
- Responsive browser acceptance checks at phone/tablet/desktop widths plus normal repository quality gates.

## Acceptance criteria

- No intentional horizontal page overflow at common phone widths; horizontal scrolling remains localized to tables/carousels/navigation where required.
- Touch controls remain usable at narrow widths and safe-area insets are respected.
- Viewer, Studio and Admin share the same visual tokens and surface hierarchy.
- Primary brand gradients and logo remain consistent throughout the product.
- Focus-visible, reduced-motion and TV focus behavior remain intact.
- Existing unit/integration/build/browser acceptance gates remain green.
