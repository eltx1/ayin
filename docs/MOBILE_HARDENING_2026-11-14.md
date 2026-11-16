# AYIN mobile hardening — 14 November 2026

This is implementation evidence, not a claim of production deployment or store approval. Changes belong to PR #316; merging it deploys the website/API and requires a separate deployment decision.

## Architecture retained

Existing Android WebView and iOS WKWebView hosts remain in use. AYIN serves the trusted hosted interface; finite, capability-checked bridge v1 invokes compiled native services. No Capacitor rewrite, arbitrary invocation, executable bundle updater or authentication replacement was introduced. Native SDK versions remain pinned in the existing Gradle/Swift package locks.

| Task                    | Implemented                                                                                                                                                                                       | Acceptance still required                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Navigation ads          | Short-lived natural home/search/channel transition, fresh identity reconciliation, no late replay after consent/config/account changes                                                            | Configured test ad on physical Android/iOS                                                       |
| Admin hot configuration | Validated revision, five-minute foreground polling; focus/resume refresh after 30 seconds; manual refresh; candidate waits during media/upload/web/fullscreen ads; native busy rejection          | Change actual test unit in admin and observe next safe activation                                |
| Diagnostics             | Local status plus separate explicit first-party opt-in; versioned server consent/withdrawal barrier; latest snapshot only, seven-day retention, once/minute, SUPERADMIN lookup                    | Isolated DB integration and deployed admin acceptance                                            |
| Provider acceptance     | Existing Firebase/FCM/GMA acceptance paths retained; no production requests or mass push sent by these changes                                                                                    | Real DebugView receipt, test creative, FCM/APNs receipt, physical lifecycle checks               |
| Video source recovery   | Android one SAF read grant, seven days; iOS bounded local inbox/bookmark, 24 hours; explicit selection; source cleanup on logout/known switch, not initial bind or transient auth outage          | Provider revocation/process-death/large-file tests on device                                     |
| Sharing and links       | Finite public URL system sharing; Android single-video share intent; iOS embedded AYINShare extension and App Group; existing verified links/session flow preserved                               | OS link association, inbound/outbound share and signing on devices                               |
| Media lifecycle         | Android actual fullscreen PiP, audio focus/headset pause; iOS WebKit PiP fallback and interruption handling; no automatic mobile lifecycle resume                                                 | Physical PiP/audio/background/memory acceptance                                                  |
| Safety/store readiness  | Public bilingual deletion/support; existing verified deletion lifecycle reused; report video/Clip/comment/channel; existing blocking/moderation retained; privacy draft and signing documentation | Public deployment, staffed support/moderation, review account, screenshots and store disclosures |

## Remote configuration is not a new store build

After this native shell is installed, supported banner/interstitial unit IDs, platform/placement enablement and bounded timing limits come from AYIN admin. Web/WebView inventory remains separate from GMA native inventory. Changed configuration is activated only when safe, not midway through an upload or ad. Old cached configuration never restores optional ads/analytics/push offline; failed refresh keeps a recent valid in-memory configuration, then fails optional integrations closed after 24 hours without a successful check.

SDK/App ID changes, new native ad formats/adapters, permissions, signing/capabilities or native bug fixes still require a new store binary. Publishing the site changes the hosted UI; it does not modify native SDKs. The implementation is not an executable OTA bundle mechanism or a review bypass.

## Important capability limits

Privacy follow-up, 15 November: a deferred configuration expires after 24 hours, including while activation is awaiting native acknowledgement. Expiry revokes Analytics authority and cannot be undone by a focus/identity refresh until a fresh configuration is safely applied. Native Analytics consent/user mutations are serialized and fenced to the captured account and consent epoch. A failed local consent write is not reported as saved: collection stays disabled in that session and the UI asks the user to allow storage and retry before reopening.

Operational diagnostic activation is deliberately session-only: an old server grant never restarts reporting automatically. A failed withdrawal is recorded locally and retried at most once per minute while the same account is present; losing or blocking local storage still cannot auto-enable diagnostics. The settings display subscribes to explicit grant/withdrawal changes.

- Source recovery is **not an OS-managed background R2 upload service**. Foreground multipart/resume/verification remains the existing upload path. Killing the app can pause transfer; access depends on the provider and OS. No native background transfer completion has been claimed.
- iOS 18.4+ exposes the custom WKWebView file picker. Older iOS uses export to Files/reselection for incoming shared video. Share imports are one video, at most 2 GB, and do not upload automatically or share auth with the extension.
- OAuth was not invented: no new OAuth provider or login replacement was added. Any future provider needs a system-browser callback implementation and separate acceptance.
- Cast, rewarded economics and additional mediation adapters were not silently added. They need explicit product/configuration choices and likely native releases.
- No signing credentials, production Firebase configuration or physical test devices were available to this execution. Simulator/unit mocks cannot prove provider delivery.

## Reproducible verification and release

Local checks include full web/API unit suites, typechecks, targeted ESLint, 21 credential-free Python release-gate tests and plist/YAML validation. Native compilation, Android emulator instrumentation, iOS XCTest/archive and PostgreSQL/E2E suites are CI gates; consult the exact candidate commit's run results, not an older PR run. `scripts/mobile-validation-test.py` now validates two distinct iOS App Store profiles and the required sharing App Group without real credentials.

See `MOBILE_RELEASE_OPERATIONS.md` (including its physical-device acceptance matrix), `MOBILE_STORE_REVIEW_DRAFT.md`, `platforms/ios/MOBILE_RELEASE.md` and `platforms/android/store/MOBILE_INTEGRATIONS.md` for account fields and real-device checks. Keep credentials in the protected GitHub environment, never in chat or artifacts. Do not run signed builds or submit until the owner supplies the configured environment and approves those gates.

Deployment includes additive migration `20261114190000_mobile_diagnostics`. Roll back runtime settings with the existing admin kill switches; roll back hosted web/API to the last compatible deployment. Leave the additive diagnostics table in place on application rollback rather than deleting consent records. Native regression rollback uses the store release track/version process, not a server-side SDK replacement. Public release remains independently approved after internal/TestFlight acceptance.
