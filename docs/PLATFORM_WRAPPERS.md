# AYIN PWA and platform wrapper strategy

The web/PWA remains the product source of truth. Platform wrappers consume the same deep links and expose only a narrow `AYIN_PLATFORM_BRIDGE` capability contract.

## PWA

The service worker precaches the small app shell/repository-owned icons and cache-first static assets. Only explicitly safe same-origin public/read API paths may use network-first fallback caching. Video/audio, watch/media/playback/upload paths are deliberately never offline-cached as a library.

Install UI is optional and dismissible. Service-worker updates surface only after a replacement worker is installed; users opt into reload. Safe-area CSS supports notches/home indicators.

## Wrapper candidates

- Android/iOS: hybrid shell (Capacitor-equivalent candidate) around HTTPS web origin, using native bridge only for platform capabilities that need it.
- Android TV / Fire TV: thin web shell with remote-key/native lifecycle bridge; web remote mapper remains fallback.
- Samsung Tizen: packaged web application using the same routes and bridge contract.
- LG webOS: packaged web application using the same routes and bridge contract.
- Roku and tvOS: exceptions requiring more native-specific clients later; do not pretend the web wrapper is sufficient.

Store packages/signing are intentionally deferred to Tasks 37–38.
