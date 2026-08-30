# Google Ad Manager production activation

Task 36 connects AYIN's existing provider-neutral video/display advertising boundaries to a production-safe Google Ad Manager configuration contract without inventing account identifiers.

## Safety defaults

AYIN ships with Google production delivery disabled. `GAM_TEST_MODE` defaults to `1` and `GAM_PRODUCTION_ENABLED` defaults to `0`. Production cannot be enabled unless all required real values are supplied and test mode is explicitly disabled.

Required environment values:

- `GAM_NETWORK_CODE` — real numeric Ad Manager network code.
- `GAM_PUBLISHER_ID` — real Google seller publisher ID in `pub-` plus 16 digits format.
- `GAM_VIDEO_AD_UNIT_PATH` — real video ad-unit path from the selected network.
- `GAM_DISPLAY_AD_UNIT_PREFIX` — real display inventory prefix/path owned by the selected network.
- `GAM_ADS_TXT_RELATIONSHIP` — `DIRECT` or `RESELLER` according to the real commercial relationship.
- `GAM_TEST_MODE=0` only after test validation.
- `GAM_PRODUCTION_ENABLED=1` only for the approved live rollout.

No example identifier in tests or documentation is a production identifier.

## Existing AYIN abstractions preserved

- In-player video ads continue through the existing IMA-ready video-ad boundary.
- Outside-player inventory continues through the GPT-ready page-ad boundary.
- House and direct-campaign fallbacks remain available.
- The existing emergency advertising kill switch remains authoritative and blocks GAM client configuration immediately.
- Creator TV linear ad markers remain provider-neutral; real Google DAI/SSAI activation still depends on the selected live/linear provider and real GAM configuration.

## Privacy / consent contract

`GET /ads/gam/config` accepts the resolved privacy mode from AYIN's consent layer rather than attempting to infer legal consent itself. Supported modes are:

- `PERSONALIZED`
- `NON_PERSONALIZED`
- `LIMITED_ADS`

For non-personalized requests AYIN returns the client privacy flag and the IMA `npa=1` parameter. For users marked under the age of consent it also returns the IMA `tfua=1` parameter. Child-directed and limited-ads flags are carried separately so the web/native adapters can map them to the applicable Google SDK request APIs.

The consent UI/legal policy remains a product/legal responsibility. The ad adapter consumes the resolved decision; it must not upgrade a restrictive privacy decision to a less restrictive one.

## Request metadata and reporting identifiers

The GAM client configuration provides bounded first-party targeting metadata for device class, AYIN session ID, channel ID and video ID when available. These identifiers are for request correlation and reporting; the adapter does not expose email addresses or raw private watch history.

## Authorized sellers

`GET /admin/advertising/gam/authorized-sellers` returns a Google authorized-seller row only when a real publisher ID and relationship are configured. The canonical Google seller domain is `google.com`; the TAG certification authority ID is `f08c47fec0942fa0`.

The production `ads.txt` / `app-ads.txt` file must use the real rows generated/confirmed in Google Ad Manager and be published on the correct root/developer domain. AYIN never manufactures a `pub-` ID. Google may decline auctions where the seller ID is missing or incorrect, so deployment verification must check the actual crawled file after publication.

## Admin diagnostics

`GET /admin/advertising/gam/diagnostics` reports:

- whether required configuration is complete;
- whether test mode or production mode is active;
- whether the emergency kill switch is enabled;
- which required settings are missing;
- masked network/publisher identity;
- whether video/display paths and authorized-seller configuration exist;
- whether AYIN is actually ready to issue live GAM requests.

## External live verification still required

Repository-side integration is complete, but the following cannot be truthfully marked complete without the real Ad Manager account and production environment:

1. confirm network code, publisher ID and owned ad-unit paths;
2. confirm CMP/consent behavior for applicable regions and age states;
3. validate GPT and IMA requests in Google test tooling/test line items;
4. publish and verify the real `ads.txt` / `app-ads.txt` rows;
5. validate fill/no-fill, frequency controls and reporting dimensions;
6. verify web, Android/TV and other target-runtime IMA behavior;
7. enable production only after the above checks, with the emergency kill switch ready.

Official guidance reviewed for this task: Google Ad Manager authorized-seller documentation and Google IMA HTML5 consent guidance current as of 2026-08-30. Those sources require publishers to use their actual Ad Manager publisher ID and document non-personalized request handling such as IMA `npa=1` rather than fabricated values.
