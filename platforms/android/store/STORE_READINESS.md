# AYIN Android / TV store technical readiness

Task 77 prepares configuration and listing requirements. No store submission is authorized by this file.

## Packages

| Flavor | Application ID | Intended channel |
| --- | --- | --- |
| mobile | net.ayin.app.mobile | Google Play Android mobile/tablet |
| tv | net.ayin.app.tv | Google Play Android TV / Google TV |
| fireTv | net.ayin.app.firetv | Amazon Appstore Fire TV Android APK compatibility |

All flavors currently use versionCode 1 and versionName 1.0.0. Release versioning must be confirmed before first submission.

## Build and signing

- targetSdk 36, compileSdk 36, minSdk 26.
- Generate release signing material outside git.
- Never commit keystores, passwords, Play service-account credentials, Amazon credentials, or signing certificate private keys.
- For Google Play App Signing, production Digital Asset Links must use the SHA-256 fingerprint of the certificate Google actually uses to sign distributed builds.
- Publish assetlinks.json at https://ayin.stream/.well-known/assetlinks.json with no redirect after release package identity and signing fingerprints are final.
- Release artifacts should be produced from an exact reviewed commit with the repository's release pipeline.

## Google Play mobile / Android TV technical checklist

- Confirm package ownership in Play Console.
- Confirm Play App Signing choice and release certificate.
- Upload an AAB only after explicit approval.
- Android TV manifest must keep Leanback launcher, no-touchscreen requirement, TV banner and launcher icon.
- Replace baseline launcher/banner assets with final production artwork before submission.
- Prepare final app name, short description, full description, screenshots, TV screenshots, feature graphic/icon and support/contact details.
- Complete Data safety and privacy-policy declarations from actual production data behavior.
- Verify Android App Links with the release signing certificate.
- Run physical Google TV / Android TV acceptance for D-pad focus, Back, fullscreen, HLS, MP4 fallback, captions, autoplay, IMA, Creator TV, live, suspend/resume and network recovery.
- Current AYIN targetSdk 36 is above the current Android TV Play requirement of API 34+.

## Amazon Appstore / Fire TV technical checklist

- Do not submit the fireTv flavor until explicit approval.
- minSdk 26 means this APK baseline intentionally excludes Fire OS 5 (API 22) and Fire OS 6 (API 25).
- Fire OS 7+ Android-based devices are technically inside the SDK range, but compatibility must be proven on representative physical Fire TV hardware.
- Vega OS devices are a separate platform and are not covered by this Android APK flavor.
- Replace baseline TV artwork with final Amazon-compliant icon/banner/store images.
- Select only the device families actually supported after physical testing.
- Complete Amazon privacy/data-use questionnaire and privacy policy fields from actual product behavior.
- Validate Fire remote D-pad/focus, Back, media keys, audio/lifecycle behavior, WebView playback, IMA, captions, Creator TV, live and network loss on Fire OS hardware.
- Emulator success or a Google TV emulator run of fireTvDebug is not Fire TV certification.

## Metadata requiring product approval

The following are intentionally not invented in Task 77 and must be approved before submission:

- final public app title and localized titles;
- short and long store descriptions;
- category selections;
- support email/website/phone values;
- privacy-policy URL if different from the canonical AYIN policy location;
- content rating questionnaire answers;
- countries/regions and pricing/distribution selections;
- final screenshots, feature graphics, TV banner and promotional assets;
- release notes;
- Play/Amazon tester tracks and rollout percentage.

## Release App Links template

After signing is final, the production assetlinks.json needs one statement per package that should own ayin.stream URLs. Example shape:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "net.ayin.app.tv",
      "sha256_cert_fingerprints": ["REPLACE_WITH_FINAL_RELEASE_SHA256"]
    }
  }
]
```

Do not publish the placeholder.