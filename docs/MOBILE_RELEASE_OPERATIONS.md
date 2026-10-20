# Mobile release operations and external setup

This runbook describes the implemented release path. It is not evidence that a credential, membership, store submission, SDK event or physical device has been verified. Use the accompanying release evidence report for actual results.

## Stable app identities

- Android phone/tablet: `net.ayin.app.mobile`. Existing Google TV/Fire TV identifiers remain separate.
- iOS: `net.ayin.app.ios`. Existing tvOS remains separate.
- Main hosted UI: `https://ayin.stream`; API: `https://api.ayin.stream`; media: `https://media.ayin.stream`.
- Source of runtime configuration: AYIN admin mobile controls; API `/mobile/config`, through the web's existing `/api` proxy where used. There is no second Firebase Remote Config source.

## Secure configuration

Set values through GitHub repository/environment settings and the deployment secret store, never in a chat message, tracked file, PR, or build log. Client Firebase identifiers are embedded app configuration; backend sender keys and signing keys are secrets. Use the `mobile-production` GitHub environment. A distinct staging host/session setup is not currently configured; debug validation is a separate test build, not a claim that staging exists.

| Location                           | Exact field                                                                                                             | Purpose                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GitHub environment variable        | `AYIN_ADMOB_ANDROID_APP_ID`                                                                                             | Android AdMob app registration, `ca-app-pub-…~…`                                                                    |
| GitHub environment variable        | `AYIN_ADMOB_IOS_APP_ID`                                                                                                 | Separate iOS AdMob app registration                                                                                 |
| GitHub environment variables       | `AYIN_FIREBASE_ANDROID_APP_ID`, `AYIN_FIREBASE_PROJECT_ID`, `AYIN_FIREBASE_SENDER_ID`                                   | Firebase Android client matching the stable package                                                                 |
| GitHub environment secret          | `AYIN_FIREBASE_API_KEY`                                                                                                 | Android Firebase client configuration, restricted as appropriate in Google Cloud                                    |
| GitHub environment secret          | `AYIN_IOS_FIREBASE_PLIST_BASE64`                                                                                        | Firebase-generated GoogleService-Info.plist for the stable iOS bundle                                               |
| GitHub environment variable        | `AYIN_IOS_TEAM_ID`                                                                                                      | Apple developer team identifier                                                                                     |
| GitHub environment secrets         | `AYIN_ANDROID_KEYSTORE_BASE64`, `AYIN_ANDROID_KEYSTORE_PASSWORD`, `AYIN_ANDROID_KEY_ALIAS`, `AYIN_ANDROID_KEY_PASSWORD` | Android upload-key signing                                                                                          |
| GitHub environment secrets         | `AYIN_IOS_CERTIFICATE_BASE64`, `AYIN_IOS_CERTIFICATE_PASSWORD`, `AYIN_IOS_PROFILE_BASE64`                               | Distribution certificate/private key and matching push-enabled provisioning profile                                 |
| Backend secret mount / environment | `GOOGLE_APPLICATION_CREDENTIALS`, `FCM_PROJECT_ID`                                                                      | Path to a server-only service-account JSON with Firebase messaging permission, and matching project                 |
| Backend environment                | `MOBILE_PUSH_WORKER_ENABLED=true`                                                                                       | Explicit opt-in to dispatch existing eligible account notifications; keep false during isolated manual-device tests |
| Web server environment             | `ANDROID_APP_LINKS_SHA256_FINGERPRINTS`                                                                                 | JSON array of actual Play App Signing certificate SHA-256 fingerprints; upload/debug certificates are different     |
| Web server environment             | `IOS_APP_LINKS_TEAM_ID`                                                                                                 | Actual team ID for Universal Links association                                                                      |

Also configure Firebase Console → Project settings → Cloud Messaging → Apple app APNs authentication key. Its `.p8` material, Key ID and Team ID belong in Firebase's secure form, not the repository. Enable Push Notifications for the Apple App ID and regenerate profiles. Confirm development/production APNs environments agree with signing.

Configure UMP privacy messages in AdMob for each registered app. Ad unit IDs are separate Android/iOS app inventory and are set in AYIN mobile admin. Do not paste GAM web ad unit paths into these fields. Configure the true Google publisher/seller record through the existing AYIN authorized-seller editor; verify `https://ayin.stream/app-ads.txt` and the developer website listed in each store agree. The implementation does not invent a publisher ID.

## Owner setup for the first signed build

Start with non-secret account facts: whether Google Play Console and an active Apple Developer membership/App Store Connect team are available, whether AYIN already has a listing on either store, and the highest build number already uploaded. Repository inspection does not verify these accounts or the existence/configuration of the `mobile-production` environment.

### Android

1. Confirm the Play app's package is `net.ayin.app.mobile`. For an existing listing, use its registered upload key; generating an unrelated key will not authorize an update. If the key is lost, complete the Play upload-key reset through the authorized owner before building. For a new listing, prepare a dedicated upload key in a secure local environment and retain an encrypted owner-controlled backup; enroll the app in Play App Signing.
2. In GitHub repository **Settings → Environments → mobile-production**, set the four `AYIN_ANDROID_KEYSTORE_*` / `AYIN_ANDROID_KEY_*` secrets listed above, plus the Android Firebase and AdMob configuration. Do not send the keystore, passwords or base64 values in chat. Base64 is transport encoding, not encryption.
3. Run the signed production build after validated changes reach `main`. Check the AAB's signer fingerprint against the upload certificate registered in Play Console. `jarsigner -verify` checks signature integrity; it does not establish that the account accepts that identity. Upload the AAB to **internal testing**, then install the Play-delivered app on the test device.
4. Use the **Play app signing certificate**, which can differ from the upload certificate, when configuring Android App Links and any Firebase/OAuth certificate restrictions. Validate links against the Play-installed build.

### iOS

1. Confirm active Apple Developer membership, the correct team, an explicit App ID `net.ayin.app.ios`, and the matching App Store Connect app record. Enable **Push Notifications** and **Associated Domains** on the App ID before generating its distribution provisioning profile.
2. Prepare an **Apple Distribution signing identity** exported as password-protected `.p12` containing both certificate and private key, and its matching **App Store Connect distribution provisioning profile**. A downloaded `.cer` alone is insufficient. Populate `AYIN_IOS_TEAM_ID`, `AYIN_IOS_CERTIFICATE_BASE64`, `AYIN_IOS_CERTIFICATE_PASSWORD`, and `AYIN_IOS_PROFILE_BASE64` through the GitHub environment settings, together with the iOS Firebase and AdMob configuration.
3. Configure the **APNs authentication key `.p8` in Firebase Console** separately. It authorizes push delivery; it is not the `.p12` signing identity and does not sign the IPA. Confirm the Firebase app, Apple team and bundle ID agree.
4. The GitHub macOS job builds the signed archive and exports an App Store IPA. Upload using authorized Xcode/Transporter access, then distribute through **TestFlight**. An App Store IPA is not a direct sideload package. Ad hoc distribution would require a different profile with registered device UDIDs and an additional export path; the current workflow does not implement it.

The workflow creates artifacts only; automatic Play/App Store uploads and their API credentials are not configured. Manual authorized upload is the initial path, so store-upload service-account/API keys are not prerequisites for building these artifacts. No membership purchase or account permission change is performed by the workflow. Rebuild with the real production configuration; merely signing a prior debug/test artifact does not convert its SDK configuration into a production release. Signed builds and real-device SDK acceptance remain unverified until these steps actually run.

Official references: [Android app signing](https://developer.android.com/studio/publish/app-signing), [Apple App Store provisioning profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/), [Apple signing identity export](https://developer.apple.com/documentation/xcode/sharing-your-teams-signing-certificates), [App Store Connect uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), and [Firebase APNs setup](https://firebase.google.com/docs/cloud-messaging/ios/get-started#upload_your_apns_authentication_key).

## Build and promote

1. Run PR validation. It creates a debug APK, minified unsigned AAB, simulator app, unsigned iOS archive, test results, dependency locks and metadata where jobs succeed. Debug builds use official Google test inventory. Missing Firebase project config must leave core content available.
2. Review and commit the actual generated Gradle lock and SPM Package.resolved. Repeat exact-head validation after a lock changes. A workflow refusing a missing lock is a release safeguard, not a successful release.
3. After review/merge, run **Mobile release artifacts (no store publication)** on `main`, choose Android or iOS, supply a new monotonically increasing build number and marketing version. Set signing only after the secure environment is configured. The workflow does not purchase accounts or submit to stores.
4. Verify signing identity, minified startup, mapping/dSYMs, Android 16 KB ELF/ZIP checks, package/bundle IDs and SHA metadata. Successful static alignment is not a substitute for a real 16 KB device/emulator run.
5. Upload signed AAB to Google Play internal testing and IPA/archive through App Store Connect/TestFlight using authorized account access. Developer membership, certificates and store account readiness must be checked in the actual consoles.
6. Install the distributed builds on dedicated Android/iPhone test devices. Use only test ads and specific test-device registrations. Capture evidence below. Never send a test campaign to all users.
7. Public rollout requires a separate owner decision based on the release evidence, populated reviewer-visible content, privacy disclosures and reviewer access.

## Provider acceptance evidence to collect

| Feature            | Required evidence                                                                                                                               | What does not prove it                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| AdMob              | Visible official test creative, load/show/dismiss callbacks, consent/no-fill/timeout checks, device + app version                               | SDK dependency or mocked callback                          |
| Firebase Analytics | DebugView native event received once with approved parameters, user ID cleared on logout, no SDK-owned revenue duplication                      | Calling logEvent locally                                   |
| FCM Android        | Targeted send record + device receipt/open in foreground/background/terminated; permission denial/revocation and force-stop limitation recorded | FCM HTTP 200 alone                                         |
| FCM/APNs iOS       | Correct FCM token from Firebase, APNs binding, signed physical iPhone receipt/open and cold launch                                              | APNs token mistaken for FCM token or simulator-only result |
| Crashlytics        | Controlled test crash from a test build, mapped native stack/dSYM association                                                                   | SDK installed or mapping file saved                        |
| Upload             | Actual selected video, interruption/reselection/resume, completed file byte integrity, no premature READY                                       | Storage-provider unit mock                                 |

For Android Analytics DebugView, use `adb shell setprop debug.firebase.analytics.app net.ayin.app.mobile` on the test device and clear it afterwards with `.none.`. On iOS, use Firebase's debug launch argument in the test scheme and inspect the linked project's DebugView. Do not enable debug diagnostics for public production sessions.

## Limits that need explicit release decisions

- General-audience configuration does not establish a viewer's age. Optional native ad/analytics operation is blocked for unknown/Kids contexts; the web asks for an explicit adult affirmation before enabling the supported adult path. No birth date is logged to Analytics. Owner must still declare the app's real audience and complete store age-rating questionnaires.
- Web GPT/IMA inventory is disabled in the new mobile hosts. Native banner/interstitial do not provide content preroll/midroll. Enabling native content ads requires a separately validated IMA/player implementation and potentially a new binary. Web/PWA IMA remains available under its existing controls.
- Rich image notifications are disabled (`richMedia:false`). A Notification Service Extension is not claimed shipped; enabling rich images later needs a tested extension and signed build.
- Rewarded, App Open, in-feed native ad templates, extra mediation adapters, camera/microphone capture, Cast, incoming Share Extension and guaranteed background uploads are not implemented preemptively. No unused camera/microphone permission is requested. Each new native capability can require a new binary.
- Browser uploads use sliced files. Recovery after process termination requires source-file reselection; there is no promise of unlimited background execution or persisted file access.
- Android force-stop and iOS background/silent delivery are OS-controlled; do not promise delivery or wakeups. An already queued OS alert cannot be recalled by logout; ordinary push content is intentionally generic and destinations are resolved only after authenticated ownership checks.
- iOS's retained native fallback and hosted web session are separate. It is not a silent single-sign-on implementation.

## Rollback

Turn off platform-specific ads, analytics or notifications in AYIN mobile admin for a feature rollback. Client configuration is fetched at hosted-interface initialization, so this is not an instant broadcast to already-open sessions: it takes effect at the next initialization. The server push dispatcher separately rechecks configuration before sending. Keep the push worker disabled until delivery configuration is accepted. Do not modify settings during an ad or upload; clients apply them on safe initialization boundaries. Existing in-flight OS push delivery is not recallable.

For hosted UI regressions, use the established AYIN server release rollback and retain backward-compatible bridge handling. Do not force-reload active uploads or playback. Native optional features fail closed on unsupported config; old PWA/native clients retain their existing fallbacks. A bundled retry screen is not a last-known-good offline copy of the full SSR site.

For binary defects, pause store rollout and submit a corrected signed build with a higher build number. Stores do not provide a universal downgrade mechanism for already installed apps. Database migrations here are additive; prefer disabling new runtime features to destructive rollback of device/audit tables.
