# AYIN tvOS store readiness

Task 81 creates the initial native Apple TV application. It does not claim App Store submission or approval.

## Signing boundary

Do not commit Apple certificates, provisioning profiles, Team credentials or App Store Connect API private keys. Repository CI builds the tvOS simulator target with signing disabled.

## Universal links

The app declares applinks:ayin.stream. Production AASA verification requires the real Apple Team ID.

Deploy the AASA template at https://ayin.stream/.well-known/apple-app-site-association after replacing <APPLE_TEAM_ID>.

## Top Shelf

Top Shelf is intentionally not bundled in Task 81. Add a TVServices extension only after a bounded server feed/artwork contract exists and validate its tighter extension memory budget on Apple TV hardware.

## Advertising

- Creator TV linear HLS may use AYIN's server-side ad/SSAI path.
- Browser IMA is not a tvOS integration.
- Native Google IMA tvOS is the future VOD client-side integration when production ad configuration is ready.

## Store status

- Physical Apple TV: not verified
- Signed archive: not verified
- TestFlight: not uploaded
- App Store submitted: no
- App Store approved: no
