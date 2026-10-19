# Mobile store submission draft

Prepared from the 2026-10-19 source implementation. This is a draft for owner review, not a submitted Data Safety/App Privacy declaration or proof of store eligibility. The native SDKs and the hosted AYIN product both count toward disclosures.

## Proposed listing and review notes

- Name: AYIN (retain the existing product identity; confirm availability in both consoles).
- Short description: Watch videos and Clips, follow channels, and share your own videos.
- Arabic short description: شاهد الفيديوهات والمقاطع القصيرة، تابع القنوات وشارك فيديوهاتك.
- Privacy policy: https://ayin.stream/privacy
- Support entry: use the existing in-product support/contact flow; the owner must confirm the public support email required by each console. No contact address is invented here.
- Category, content rating, territories, pricing and public rollout percentage require the owner's actual product decisions.

Reviewer notes: AYIN hosts its first-party server-rendered video interface at ayin.stream within the installed mobile app. The binary contains a restricted, versioned native bridge for Google Mobile Ads, consent, Firebase Analytics/Crashlytics and push. Ordinary interface/content updates use the website deployment; new native capabilities require a new binary. Ads and optional telemetry require the documented consent/audience gates. There is no rewarded-currency system, hidden mini-app catalog, or remote native-code installer. The iOS optional native video browser has a separate login from the hosted interface. Explain enabled functionality consistently to reviewers; do not enable undisclosed functions after approval.

Provide a dedicated, nonprivileged reviewer account through the store's secure review-access fields, with populated playable public videos/Clips. Do not put its password in Git or this document. Live inspection found creator/video listings, but did not establish successful playback or complete review access. Production discovery's empty home rows need review before submission.

## Data disclosure inventory

| Data category                                                                                          | Observed use                                                      | Proposed purpose / disclosure work                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email, account/display name                                                                            | Existing signup, profile, recovery, support                       | Account management and app functionality; linked to account. Verify production retention and deletion policy.                                                          |
| Internal account/profile/channel IDs, subscriptions and social graph                                   | Sessions, channels, follows, blocking, moderation                 | Functionality and safety; linked to account. Native Analytics receives an opaque account ID only after consent and clears it on logout.                                |
| Uploaded video/audio/images, comments, reports, support submissions                                    | Creator uploads and UGC interaction                               | Functionality and moderation; user-selected content, potentially publicly shared. Do not equate public posting with unrestricted third-party collection.               |
| Watch history, searches and product interaction data                                                   | Existing first-party analytics/history and opted-in native events | Personalization/functionality/analytics according to actual product controls. Native events exclude query text, titles, URLs and free-text errors.                     |
| Installation ID, FCM token, platform/app version, notification preferences                             | Multi-device registration and targeted push                       | Functionality; associated with the authenticated account/session. Server-only tokens, no raw token logs. Account logout/deletion removes bindings.                     |
| Ad interaction, SDK device/network information, coarse location inferred by providers where applicable | Google ad/consent SDK operation                                   | Advertising and fraud prevention; review Google SDK disclosures and actual AdMob settings. Nonpersonalized ads do not mean no data collection.                         |
| App interactions and app-instance identifiers                                                          | Optional Firebase Analytics                                       | Analytics, explicit opt-in. No Firebase authentication migration and no Firebase web analytics SDK added. Confirm SDK automatic event collection in configured builds. |
| Crash diagnostics, device/app diagnostic details                                                       | Optional native Crashlytics                                       | Diagnostics, same explicit analytics/diagnostics opt-in. No app-provided user ID or custom free-text crash log. JavaScript exceptions are not automatically covered.   |
| Creator legal name, country, payout destination and earnings                                           | Existing creator compliance/payout functions when used            | Functionality/compliance; financial data disclosures must reflect these existing hosted flows. Optional native SDK work does not remove them from the app's inventory. |

For Play, classify each category's collection, sharing/service-provider treatment, optionality and deletion behavior against the deployed services. For Apple, determine linked-to-user and tracking answers from actual processing, consent and merged SDK privacy reports. Do not copy a blanket “no data collected” or “no tracking” answer from the absence of an ATT prompt. The current iOS build avoids AdSupport/IDFA collection and uses nonpersonalized ad settings; if production processing becomes cross-company tracking, an ATT-compliant implementation and revised disclosures are required before enabling it.

## UGC and release evidence

Existing reporting, moderation, privacy/export/delete-account and support paths are retained. This change adds authenticated account-wide blocking, unblocking, interaction restrictions and notification filtering. Public anonymous catalog pages remain public; blocking is not a promise to erase public content from the internet. Review response staffing and terms acceptance with the owner.

Use actual signed-device screenshots of Home, Clips, Watch, channel and Account/privacy at the required console sizes. The native icon reuses AYIN's existing A/play identity. No marketing screenshot or device delivery evidence is fabricated. A simulator capture can support layout review, but cannot prove ads, APNs delivery, background execution or performance on a physical device.

Submission remains blocked until the configured SDK/device checks, signing/membership checks, playable review content, actual store screenshots, age/audience declarations and final privacy answers are accepted. Start with internal testing/TestFlight; public publication is a separate owner decision.

Primary disclosure references reviewed: https://developers.google.com/admob/ios/privacy/data-disclosure , https://firebase.google.com/support/privacy , https://firebase.google.com/docs/ios/app-store-data-collection .
