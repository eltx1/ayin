# AYIN Samsung TV store technical readiness

Task 78 prepares technical requirements only. It does not authorize or perform a Samsung Seller Office submission.

## Current package identity

- Tizen profile: tv-samsung
- Widget version: 1.0.0
- Application ID: AYINtv2026.AYIN
- Package ID: AYINtv2026
- Minimum Tizen platform: 9.0
- Development API baseline: 9.0

Version/package identifiers must be confirmed before first production submission because published-app updates have identity and signing continuity requirements.

## Signing requirements

Before release:

- install current Tizen Studio;
- install current Samsung TV Extension and Samsung Certificate Extension;
- create a Samsung certificate profile;
- protect author/distributor certificates and passwords outside git;
- keep the original author certificate backed up for future updates;
- build the signed WGT with Samsung/Tizen tooling.

No certificate, password, signed WGT, or Seller Office credential is stored in this repository.

## Hosted/remote-content classification

The app uses a local packaged shell but renders the shared AYIN application remotely in an iframe. Samsung states that hosted/cloud-based applications normally require prior Content Manager approval and are accepted only in special cases.

Before Seller Office submission, confirm this architecture with the assigned Samsung Content Manager. Do not assume store eligibility from repository tests.

## Required store assets and metadata

Task 78 intentionally does not invent:

- final Samsung TV launcher icon;
- store icon and screenshots;
- app title/localized titles;
- short and long descriptions;
- category;
- privacy policy URL;
- support contact details;
- content rating answers;
- countries/regions;
- release notes;
- monetization disclosures;
- final certificate fingerprints/profile;
- Seller Office distribution/model groups.

The checked-in icon.png is a technical package icon. Final Seller Office icon/screenshots must still satisfy Samsung artwork requirements before submission.

## Release validation gates

- build a signed WGT with the intended production certificate;
- install it on Samsung TV Simulator/Emulator where applicable;
- install it on representative physical Tizen 9.0 and Tizen 10.0 TVs;
- complete the real-device matrix in docs/TIZEN_CERTIFICATION.md;
- validate login/session, remote/focus/back/exit, HLS/MP4, captions, autoplay, fullscreen, Creator TV/live, network recovery and lifecycle;
- validate IMA/GAM behavior on hardware if client-side ads are enabled;
- verify HTTPS endpoints and TLS chains from the TV;
- verify uninstall removes user login data;
- confirm remote-content architecture with Samsung Content Manager.

## Submission state

- Samsung Seller Office submitted: **No**
- Samsung review started: **No**
- Samsung store approved: **No**
- Real Samsung TV certification claimed: **No**
