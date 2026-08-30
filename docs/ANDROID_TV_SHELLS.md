# Android, Google TV and Fire TV shells

AYIN keeps one shared web product and wraps it in a thin Android `WebView` host. The shell does not duplicate account, catalog, player, ads, analytics, Studio or Admin business logic.

## Variants

The Gradle project under `platforms/android` builds three flavors:

- `mobile` — Android mobile/tablet shell, application id suffix `.mobile`, platform id `android`.
- `tv` — Android TV / Google TV shell, application id suffix `.tv`, platform id `google-tv`.
- `fireTv` — Fire TV-compatible Android shell, application id suffix `.firetv`, platform id `fire-tv`.

All variants load only the canonical `https://ayin.stream` origin inside the WebView. External HTTP(S), mail and telephone links leave the shell. Cleartext traffic, file access and content access are disabled.

## Shared bridge

`apps/web/src/lib/native-shell-bridge.ts` is the shared browser-side capability boundary. The Android host exposes `window.AyinNative` for:

- platform identification;
- external-link requests;
- fullscreen requests;
- bounded playback-state notifications for a future native `MediaSession` adapter.

Lifecycle and non-D-pad remote media events are sent as `ayin:native-lifecycle` and `ayin:native-remote` custom events. D-pad and Enter are deliberately delegated to WebView as ordinary keyboard events so the shared TV focus system remains authoritative.

## Deep links

The shell accepts:

- verified `https://ayin.stream/...` app links;
- custom `ayin://...` links mapped back onto the canonical AYIN origin.

The production web deployment must publish a valid Android Digital Asset Links file at `/.well-known/assetlinks.json` containing the final signed package ids and SHA-256 signing certificate fingerprints. Those fingerprints cannot be created safely in source control before release signing exists.

## Build validation

Repository CI builds and lints all three debug variants with JDK 17, Android API 36, Android Gradle Plugin 8.13.x and Gradle 8.13. Release signing keys are never committed.

Local examples:

```bash
gradle -p platforms/android :app:assembleMobileDebug
gradle -p platforms/android :app:assembleTvDebug
gradle -p platforms/android :app:assembleFireTvDebug
```

## Store and device prerequisites

Repository-side packaging is complete without pretending that desktop-browser behavior proves TV behavior. Before a production release:

1. replace the build-safe vector TV banner with final store artwork and add final launcher/store artwork;
2. configure release signing outside git and publish matching Digital Asset Links;
3. install the TV flavor on representative Android TV / Google TV hardware and the Fire TV flavor on representative Fire OS hardware;
4. verify D-pad focus order, Back behavior, fullscreen entry/exit, pause/resume, deep links and external-link handling;
5. validate the actual Google IMA runtime on each target family, including ad focus/skip controls, consent state, no-fill and ad-error fallback. Desktop IMA success is not treated as TV verification;
6. complete Google Play / Amazon Appstore listing, privacy/data-safety declarations and store policy checks with the final package/signing identities.

Fire TV remains an Android-compatible shell here. Amazon's newer Vega WebView runtime is a separate platform option and is not silently treated as equivalent to Fire OS Android APK behavior.
