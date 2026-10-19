# AYIN Android mobile bridge v1

The existing production-origin AndroidX WebView shell is reused. Its existing mobile package ID remains `net.ayin.app.mobile`; TV `net.ayin.app.tv` and Fire TV `net.ayin.app.firetv` do not link Google Mobile Ads or Firebase. No Capacitor/live reload/bundle OTA mechanism is added. Daily UI changes are served by the existing HTTPS `https://ayin.stream` origin; local native offline/retry UI survives connection failure, but does not pretend to provide offline video or a bundled copy of the SSR application.

## Native SDK pins

- Google Mobile Ads `com.google.android.gms:play-services-ads:25.5.0` (2026-09-17 supported Legacy API; min API 24, shell min 26). Chosen for official stable native banner/interstitial APIs and existing AndroidX compatibility, not third-party bridge maintenance. No mediation adapters installed.
- UMP `com.google.android.ump:user-messaging-platform:4.0.0`.
- Firebase BoM `34.19.0`, with `firebase-analytics`, `firebase-messaging`, and `firebase-crashlytics`. This reviewed pre-35 major line avoids introducing the October Firebase major upgrade simultaneously with first integration. No Firebase Auth/database replacement.
- Crashlytics Gradle plugin `3.0.8` and Google Services `4.5.0`, applied only when actual Firebase client config is supplied.
- Existing AGP 8.13.2, Kotlin 2.2.21, compile/target SDK 36 and Java 17 retained.
- Gradle dependency locking is enabled; CI must resolve/write and review actual locks. An unresolved lockfile is not a reproducible release.

Official references checked 2026-10-19: https://developers.google.com/admob/android/rel-notes , https://developers.google.com/admob/android/privacy , https://firebase.google.com/support/release-notes/android .

## Build configuration

Pass through secure CI environment configuration or local Gradle properties. Never paste signing keys into chat or commit configuration files. Firebase client configuration is not a server credential; use project/app restrictions.

| Name | Purpose |
| --- | --- |
| `AYIN_FIREBASE_ANDROID_APP_ID` | Firebase Android app ID for `net.ayin.app.mobile` (not the package name) |
| `AYIN_FIREBASE_API_KEY` | Restricted Firebase client API key |
| `AYIN_FIREBASE_PROJECT_ID` | Firebase project ID |
| `AYIN_FIREBASE_SENDER_ID` | Firebase project number / sender ID |
| `AYIN_FIREBASE_CONFIG_FILE` | Actual Firebase Android client `google-services.json`, stored outside Git; required with configured Firebase |
| `AYIN_CRASHLYTICS_UPLOAD_MAPPING` | `true` for configured signed release, `false` for unsigned CI checks |
| `AYIN_ADMOB_ANDROID_APP_ID` | Android AdMob app ID with `~`, release only |
| `AYIN_VERSION_CODE` | Monotonically increasing integer, default 2 |
| `AYIN_VERSION_NAME` | Version name, default 1.1.0 |

Without client configuration, the shell still opens, and `runtime.configure` reports `configured.firebase=false` and/or `configured.ads=false`. These conditions are deployment blockers for the corresponding real SDK proof. Debug always uses Google's sample app ID and sample banner/interstitial unit IDs. Release testMode also uses sample units. An unconfigured unsigned CI validation release uses Google’s documented sample manifest App ID only to keep the standard provider startup safe; BuildConfig remains unconfigured, ad capabilities stay off, and publication must be blocked. Real inventory requires configured app ID, explicit intended general audience, declared age signal, UMP permission and validated AYIN admin configuration. The sample app ID cannot substitute for configuring a real UMP message.

`firebase_analytics_collection_enabled=false`, automatic native screen reporting disabled, Firebase messaging auto-init off, advertising consent denied by default. Native Analytics only enables after explicit per-session opt-in and server config. UMP is requested each native app launch by the authenticated web runtime, never inferred from cached strings. Privacy settings expose UMP options when required. Account reset clears Analytics user ID/data, disables FCM auto-init, unbinds local account before async token deletion, cancels delivered notifications and invalidates ad requests.

## Bridge and lifecycle

`window.AyinMobile` is installed only in the top frame at the exact trusted HTTPS origin. Transport additionally verifies the actual WebView instance, source origin and main-frame status. All requests use an allowlist and schema; no reflection, eval transport, native file API or arbitrary method dispatch. Pending responses are fenced by document generation and IDs, and scripts cannot gain a bridge through external links or subframes.

Capabilities are `privacy`, `analytics`, `ads.banner`, `ads.interstitial`, `notifications`, `session.reset` only when actually configured. `runtime.configure` consumes `{config:...}` from the shared contract, returns platform/appVersion/installationId/configured and applies minimum version/installation-stable rollout. Invalid types, unknown schema fields, wrong origins and bundle update flags fail closed. Configuration is rejected during file selection/fullscreen ad/UMP; web defers while an upload is active. Web must also maintain its own upload lifecycle guards.

Banner is an actual anchored adaptive native `AdView` in a layout region below the WebView. Interstitial is preloaded only on an explicit natural transition, returns `loading`, and only shows on a later explicit transition when ready. It never appears late over a newly started video. Both pause/cancel in background, navigation or playback and file selection. Retry is bounded by config with backoff, no-fill never retries, and limits/cooldowns apply. Paid callbacks emit estimated micros/currency/precision once per impression callback identity; Firebase SDK owns automatic ad_impression. No financial ledger writes occur.

## Push

`notifications.request` and `notifications.token` require `{accountId:<authenticated UUID>}`. The web must bind returned FCM token using authenticated `/api/mobile/devices`, and delete the device binding before logout. Permission alone does not authenticate an account. Native token rotation emits `notification.token`; web reads again after foreground/login. Android 13+ permission is asked only from an explicit user action.

Send data-only FCM messages. Local service checks opt-in, runtime-enabled type, matching `recipientAccountId`, current OS permission and a bounded duplicate-ID cache before rendering channel `ayin_updates`. Automatic FCM notification payloads bypass this local account gate and must not be used. A notification tap opens `/notifications` then emits notification ID; the web waits for session readiness and resolves `/api/mobile/notifications/:id/destination`, preserving content authorization. Force-stop prevents delivery until the user restarts the app; no guaranteed background delivery is claimed.

## Remaining verification and release gates

Run Gradle mobile unit tests, lint, debug APK, minified release APK/AAB, merged-manifest and 16KB alignment checks on CI. Run actual Google-enabled Android device tests for UMP accept/refuse/options, Analytics DebugView (`adb shell setprop debug.firebase.analytics.app net.ayin.app.mobile`), sample banner/interstitial lifecycle and FCM foreground/background/killed/tap/logout/account switch. Unit fixtures validate schema/PII rejection and cannot demonstrate SDK delivery.

Crashlytics native SDK is included, disabled by default, shares the explicitly disclosed analytics/diagnostics opt-in, clears unsent reports when disabled, and never receives a user ID/custom text logs. With real Firebase configuration, pinned Google Services/Crashlytics plugins generate build IDs. `AYIN_CRASHLYTICS_UPLOAD_MAPPING=true` uploads release R8 mapping; unsigned CI disables upload and retains mapping. Actual symbolication/crash receipt remains a configured-device release gate. Crashlytics does not capture web JavaScript errors; web monitoring remains separate. Native feed ad, rewarded, app-open, native IMA/player, Cast, camera/microphone capture, share receiving and background uploader are not added. Their adoption needs a reviewed native release. Existing document picker passes a URI and never reads the entire selected video into JavaScript. Persisted background upload/file leases are not implied.
