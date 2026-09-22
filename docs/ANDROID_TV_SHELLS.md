# AYIN Task 77 — Android / Google TV supported-device baseline

Task 77 turns the existing Task 37 WebView shells into a tested support baseline without forking AYIN account, catalog, player, ads, Creator TV, or live-streaming business logic.

## SDK envelope

- compileSdk 36
- targetSdk 36
- minSdk 26
- JDK 17 / Android Gradle Plugin 8.13.2

Google Play currently requires Android TV new apps and updates to target API 34 or higher; AYIN targets API 36. Amazon maps Fire OS 7 to Android API 28, Fire OS 8 to API 29/30, Fire OS 14 to API 31–34, and Fire OS 16 to API 35/36. Because AYIN minSdk is 26, Fire OS 5/6 are outside this baseline. Vega OS devices are also outside this Android APK baseline.

## Device and emulator matrix

| Surface | Environment | Flavor | Claim |
| --- | --- | --- | --- |
| Android mobile | Android 16 / API 36 google_apis x86_64 emulator | mobileDebug | CI candidate until final Task 77 workflow is green |
| Google TV | Android 15 / API 35 google-tv x86_64 emulator | tvDebug | CI candidate until final Task 77 workflow is green |
| Fire APK compatibility | fireTvDebug installed on the Android 15 Google TV emulator | fireTvDebug | Android compatibility smoke only; NOT Fire OS hardware certification |

The final Task 77 merge updates this matrix with the actual successful workflow run and observed emulator API/version values. A build alone is not counted as device validation.

## Validation coverage

### Build and packaging

CI assembles mobileDebug, tvDebug and fireTvDebug, runs flavor JVM tests and Android lint. TV flavors declare Leanback, no touchscreen requirement, LEANBACK_LAUNCHER, launcher icon and TV banner. Checked-in artwork is a technical baseline and is not final store marketing artwork.

### Deep links

The shell accepts canonical HTTPS links on ayin.stream and custom ayin:// links mapped to the same canonical route. HTTP, foreign hosts and unexpected HTTPS ports are rejected by the shared navigation policy. The manifest requests Android App Links auto-verification. Release verification still requires the final signing certificate fingerprints in the production assetlinks.json file.

### Login and session

Authentication remains the shared AYIN cookie/session implementation. Task 77 does not create a second native auth store. The shell accepts first-party cookies, flushes the cookie store on lifecycle transitions, and emulator instrumentation verifies a secure AYIN session-shaped cookie survives Activity recreation and WebView renderer replacement. Register/login/logout business behavior remains covered by browser acceptance.

Third-party cookies are not globally enabled.

### D-pad and focus

D-pad and Enter remain normal WebView keyboard events. Android does not own a second focus graph. Emulator tests inject real Android D-pad key events; TvFocusScope and @ayin/ui remain authoritative for spatial focus. This keeps one shared focus implementation for web, Android TV, Google TV, Fire APK compatibility, Tizen and webOS.

### Media remote buttons

Play/pause, play, pause, rewind, fast-forward and menu are normalized into the shared ayin:native-remote contract. Rewind/fast-forward reuse the existing AYIN player keyboard seek path instead of native seek business logic.

### Back

Back uses OnBackPressedDispatcher. Native fullscreen exits first, then the shared web runtime receives a cancelable BACK event. If the web layer does not consume it, WebView history is used and the Activity exits only when no in-app history remains. For Google TV deep links carrying exit_on_back=true, a one-press direct exit is supported while the hint remains armed; any intervening non-Back user action disarms it.

### Fullscreen

AyinPlayer and LiveAyinPlayer use one shell-aware fullscreen helper. Browsers use the Fullscreen API; Android additionally synchronizes immersive system bars. WebChrome custom-view fullscreen uses the same native state.

### HLS, MP4 fallback, autoplay and captions

These remain shared player responsibilities. adaptive-playback.ts owns HLS/hls.js and bounded recovery; AyinPlayer owns progressive MP4 fallback; autoplay degrades to user-start where blocked; captions remain the shared video text-track path. Android emulator tests validate the shell bridge around this runtime; repository web quality/browser tests remain the functional source of truth for player behavior.

### IMA

AdEnabledAyinPlayer remains the only VOD IMA orchestration path. Task 77 does not introduce native Android ad business logic. Existing browser acceptance verifies IMA startup/error cannot block content. Physical Google TV and Fire TV release testing is still required for real ad rendering, skip focus, consent, no-fill and error UX.

### Creator TV and live

Creator TV continues to use the shared Creator TV player and Task 75/76 linear/DAI paths. Live uses LiveAyinPlayer. Native Android connectivity changes are mapped to ordinary browser online/offline events so the existing Task 74 live reconnect/backoff behavior is reused.

### Lifecycle, low memory and renderer recovery

The shell emits pause, resume, stop, configuration-change, memory-pressure and renderer-recovered lifecycle states. The shared runtime pauses only media that was playing and resumes only that media. WebView state is saved across Activity recreation. WebViewClient.onRenderProcessGone replaces a killed/crashed renderer with a fresh hardened WebView, reloads the last trusted AYIN URL, preserves the cookie/session store, and emits renderer-recovered.

### Network loss

ConnectivityManager.registerDefaultNetworkCallback emits ayin:native-network. The shared runtime maps this to browser offline/online. If the main AYIN page failed while offline, the shell retries the last trusted URL after connectivity returns.

## Store status

Task 77 prepares technical store requirements only. It does not upload an AAB/APK, create or modify a store listing, accept store agreements, submit a release, or claim Fire TV certification from emulator results.

See platforms/android/store/STORE_READINESS.md.

## Official references

- Android TV navigation: https://developer.android.com/training/tv/get-started/navigation
- Android TV app creation: https://developer.android.com/training/tv/get-started/create
- Android App Links verification: https://developer.android.com/training/app-links/verify-applinks
- Android WebView renderer recovery: https://developer.android.com/reference/android/webkit/WebView
- Google Play target API requirements: https://support.google.com/googleplay/android-developer/answer/11926878
- Fire TV D-pad and focus guidance: https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html
- Fire OS Android/API mapping: https://developer.amazon.com/docs/fire-tv/fire-os-overview.html