# AYIN Samsung TV store technical readiness

Task 78 prepares technical requirements only. It does not authorize or perform Samsung Seller Office submission.

## Current package identity

- Profile: `tv-samsung`
- Widget version: `1.0.0`
- Application ID: `AYINtv2026.AYIN`
- Package ID: `AYINtv2026`
- Minimum Tizen platform: `9.0`
- Samsung development API baseline: `9.0`
- Package mode: hosted/cloud Web application

Task 78 intentionally replaces the pre-store Task 38 development package ID `AYINtv`, which was shorter than the 10-character Tizen package-ID requirement. The new development package ID is structurally valid. Once a package is registered/signed for distribution, do not change its Tizen ID or author-signature continuity casually because Samsung uses those for updates.

## Hosted application approval

Samsung states that hosted/cloud applications require advance Content Manager approval except in approved special cases and that Tizen APIs are not supported in hosted applications. The current local bootstrap's pre-navigation Tizen API probe is therefore an **unapproved implementation hypothesis**, not certification evidence. The same hosted boundary means Product APIs such as AppCommon screensaver control are not assumed available in the remote AYIN page; these requirements must be resolved with the Samsung-approved architecture before submission.

Before Seller Office submission:

- confirm the AYIN hosted architecture with Samsung Content Manager, including whether the packaged pre-navigation Tizen API shim is permitted;
- confirm external Google IMA/GAM resources;
- resolve Samsung hosted-app CSP policy. AYIN's shared production Web CSP currently uses `unsafe-inline` and Task 78 does not weaken global Web security to hide this requirement;
- confirm the final multi-domain external-resource/WARP declaration with Samsung Content Manager and current Tizen tooling. Samsung's Hosted Applications FAQ mentions `tizen:allow-origin` for multiple domains, but the current TV configuration guide does not provide a usable syntax for that FAQ-only element, so Task 78 does not guess one.

Repository CI is not evidence of hosted-app approval.

## Permissions/network

The package requests:

- Internet;
- TVInputDevice for the **local packaged bootstrap only**.

Samsung hosted content itself cannot use Tizen APIs. Task 78 currently attempts TVInputDevice registration in the local bootstrap before hosted navigation and then treats hosted AYIN as standard Web content. This pre-navigation pattern is not claimed Samsung-approved; both Content Manager acceptance and persistence of those registrations after hosted navigation remain release gates, followed by Samsung Emulator/TV verification.

WARP access remains HTTPS-only for AYIN and required Google advertising origins.

No HTTP/cleartext endpoint is part of the release baseline.

## Signing

Before release:

- install current Tizen Studio;
- install current Samsung TV Extension and Samsung Certificate Extension;
- create the final Samsung certificate profile;
- back up the author certificate for future updates;
- protect author/distributor certificates and passwords outside git;
- build a signed WGT with official tooling.

No signing certificate, password, signed WGT or Seller Office credential belongs in this repository.

## Store assets and metadata still required

Task 78 does not invent final Seller Office content:

- final launcher/store icon;
- screenshots;
- localized public title;
- short/long descriptions;
- category;
- privacy-policy/support contacts;
- content rating answers;
- supported countries/regions;
- release notes;
- monetization disclosure;
- model/device distribution selections.

The checked-in `icon.png` is only a technical package icon until final artwork is approved.

## Required validation gates

Before submission:

- get Content Manager hosted-app approval, including an explicit decision on the pre-navigation Tizen API shim and final multi-domain WARP policy;
- create the final Samsung signing profile;
- build and inspect a signed WGT;
- install/test on Samsung Simulator/Emulator;
- test representative physical Tizen 9.0 and 10.0 TVs;
- verify cold launch, resume and termination;
- verify login/logout/session and uninstall data removal;
- verify D-pad/focus/Enter/Back/Exit and optional media-key persistence after hosted navigation;
- verify HLS, MP4 fallback, WebVTT captions, autoplay fallback and fullscreen;
- resolve and verify Samsung screensaver suppression for all video playback states; hosted AYIN cannot call AppCommon directly;
- verify Creator TV and live playback/reconnect;
- verify physical network disconnect/reconnect and low-memory behavior;
- validate client-side IMA/GAM with the Google account team if enabled.

## Submission state

- Samsung Simulator verified: **No**
- Samsung Emulator verified: **No**
- Real Samsung TV verified: **No**
- Samsung Seller Office submitted: **No**
- Samsung review started: **No**
- Samsung store approved: **No**
