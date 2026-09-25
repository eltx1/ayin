# AYIN iOS store readiness

Task 80 prepares a buildable unsigned iOS application and distribution strategy. It does not claim TestFlight or App Store submission.

## Signing boundary

Never commit:
- Apple distribution certificates or .p12 files
- provisioning profiles
- App Store Connect API .p8 keys
- Developer Team credentials
- signing passwords

CI builds and tests with code signing disabled. Final signing belongs in protected CI/App Store Connect credentials after the App ID and team are finalized.

## Universal links

The app already declares `applinks:ayin.stream` and handles AYIN HTTPS links safely. Production universal links remain gated on the real Apple Team ID.

Deploy `apple-app-site-association.template.json` as:

`https://ayin.stream/.well-known/apple-app-site-association`

after replacing `<APPLE_TEAM_ID>` with the real Team ID. Do not guess or commit a fake identifier.

## Store status

- Signed archive: not verified
- TestFlight: not uploaded
- App Store submitted: no
- App Store approved: no
