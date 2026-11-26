# AYIN TV store release plan

AYIN TV serves the production site at `https://ayin.stream`. Each installed app supplies a small platform-specific shell for launching the site and handling the remote, lifecycle, and playback controls. Catalog, UI, translations, and ad policy changes ship with the website. Rebuild a store package when its shell, permissions, signing configuration, app identity, or packaged assets change.

## Store order and deliverables

| Order                    | Platform                 | Package and distribution                                                                           | Release checks                                                                                                                                                                          |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                        | LG webOS TV              | Hosted Web app `com.ayin.stream.tv` as an IPK in LG Seller Lounge                                  | Run on LG Cloud Test Lab or supported webOS TV 25 and 26 devices. Verify remote focus, Back and exit, video, and a test ad break.                                                       |
| 2                        | Amazon Fire TV           | Existing `net.ayin.app.firetv` Android WebView shell as a signed release APK for the Fire OS track | Verify on representative Fire OS devices or Amazon Live Device Interaction and select the proven device families. Vega OS has its own build and release track.                          |
| Parallel                 | Samsung TV               | Hosted Tizen app `AYINtv2026.AYIN` as a signed WGT in TV Seller Office                             | Get hosted architecture and origin-policy approval, request Partner Seller for distribution outside the US, secure the author certificate, and validate the WGT on supported Tizen TVs. |
| When Play access returns | Google TV and Android TV | Existing `net.ayin.app.tv` Android WebView shell as a signed AAB in Play Console                   | Confirm package availability and Play signing, upload to the Android TV test track, and verify TV launcher, remote, and Android App Links.                                              |

Fire OS still accepts Android APKs that use WebView. Amazon discontinued the separate web-app submission flow. Samsung Galaxy Store seller status applies to the phone app. Samsung TV uses TV Seller Office and its own hosted-app review. The existing Apple TV app uses SwiftUI and AVPlayer. Roku uses SceneGraph. Both are outside this web-wrapper release.

## Shared store listing draft

- **Title** AYIN
- **Category** Entertainment or Video, depending on the store taxonomy
- **Price** Free to download with video advertising
- **English** Watch videos, films, and creator channels on AYIN. Browse and search with your TV remote and enjoy a full-screen viewing experience.
- **Arabic** شاهد الفيديوهات والأفلام وقنوات صنّاع المحتوى على عين. تصفّح وابحث بريموت التلفزيون واستمتع بالمشاهدة بملء الشاشة.
- **Privacy** <https://ayin.stream/privacy>
- **Support** <https://ayin.stream/support> and `mohamed@horusmedia.net`

Capture Home, Watch, and channels from the TV layout at the store-required sizes. Complete age ratings and data disclosures from the release behavior, including user-uploaded videos and ad measurement. Choose countries and device families within the app's actual distribution and compatibility coverage.

## Advertising and playback acceptance

Use the shared AYIN player and Google Ad Manager video configuration in the admin. Start with an in-player pre-roll. Run a test ad on each target runtime using an approved test creative and eligible content. Check the existing consent and viewer protections, one pre-roll before content, skip with the remote when the ad is skippable, and resumption on completion, timeout, no fill, or an SDK error. Confirm the request, start, and completion in AYIN reporting and verify store-app mapping in Ad Manager when a public listing is available. Check the existing live and Creator TV paths separately.

Keep the source, timing and frequency in the existing admin controls. Record IMA compatibility per device family. For hardware without working client-side ad playback, retain playable video and evaluate Google-supported server-side insertion for the eligible inventory before enabling ads on that family.

## Package and test commands

The TV Web package workflow validates both bootstraps and builds the LG IPK. To reproduce the web packages from the repository root, run `node scripts/validate-tv-packages.mjs`, `node scripts/test-webos-bootstrap.mjs`, and `node scripts/test-tizen-bootstrap.mjs`. Use `ares-package -o <directory> platforms/webos` for the LG package, and the Samsung TV certificate profile with the Tizen tooling for the signed WGT.

From `platforms/android`, build `:app:assembleFireTvRelease` for Amazon and `:app:bundleTvRelease` for Google TV. Use the release version assigned to each store package. Run both flavor unit tests and release lint, verify Android package names and signatures, and keep release signing secrets in approved credential storage.

## Vendor references

- [LG hosted web apps](https://webostv.developer.lge.com/develop/getting-started/web-app-types) and [LG ACG](https://webostv.developer.lge.com/develop/guides/acg-guide)
- [Amazon release tracks and submission](https://developer.amazon.com/docs/app-submission/submitting-apps-to-amazon-appstore.html) and [Fire OS Web-based app submission FAQ](https://developer.amazon.com/docs/web-based-apps/developer-console-faq.html)
- [Samsung hosted applications](https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html) and [TV Seller Office partnership](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-partner.html)
- [Google TV distribution](https://developer.android.com/training/tv/publishing/distribute) and [IMA on additional platforms](https://developers.google.com/interactive-media-ads/docs/sdks/other)
