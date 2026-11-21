# Android UGC review evidence

This is a manual release checkpoint for public Play submission, not a claim of Google Play compliance. It does not stop an internal-testing AAB from being built, change distribution, or upload anything. An operator must verify and retain the underlying evidence before marking a check PASS.

## Why the check exists

AYIN's hosted WebView includes the public catalog and upload, Clips, channel and community features. Its signup disclosures, reports and blocking are useful controls; their existence in source does not establish reviewer access or effective human moderation.

The existing maturity and age-restriction fields are **not proof of 18+ age verification or Android filtering**. The current public playback authorization applies territory, override and Kids policy; outside Kids, the policy does not use the age label as a verified-age gate. A home-feed filter or a warning alone also cannot enforce the policy on signed-out Watch, Clips, search, deep links, public channel pages, player APIs or hosted surfaces. See [Google Play's UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937) and [App content guidance](https://support.google.com/googleplay/android-developer/answer/9859455).

For this checkpoint, the supported approach is a clear prohibition of Play-disallowed sexual content and demonstrable enforcement against access to it in the app. Do not infer prohibition from wording that it may be restricted. This is not a blanket removal of films rated mature for non-sexual reasons. Do not treat a mature label or the Kids setting as Google's separate incidental-content exception. If the product instead selects that exception, assess the exact current policy and add a separately reviewed contract for the applicable controls before using it.

## Required review records

Test on the Play-delivered internal-track build that comes from the exact candidate AAB and against the current hosted release. Record timestamp, build/version, hosted revision, device/Android version, outcome and the non-secret evidence ID in the private release record. Do not put review-account credentials, personal data or sensitive reports in Git or build logs. Use restricted fixtures and synthetic test reports; do not publish harmful material to test enforcement.

1. `guest_review_paths`: On a fresh install, confirm Home, search, Clips, a public channel, direct Watch and usable signed-out playback. Record the tested fixtures and outcomes.
2. `signed_in_review_paths`: Confirm a dedicated, nonprivileged review account can reach the core account and UGC journeys without staff intervention. Store any credentials through the approved secure **App access** fields only. Check login/session expiry and sign-out.
3. `objectionable_content_policy`: Confirm the real, live terms and both language versions clearly define prohibited behavior and Play-disallowed content; confirm support and escalation instructions work.
4. `ugc_terms_before_upload`: Confirm terms are accepted before UGC submission on supported creation routes, including pre-existing accounts if transition rules apply. A visible signup sentence alone is not proof of enforcement.
5. `report_content_and_users`: Report a video from Watch and Clips, a comment, channel/user and community post. Confirm each reaches the moderation queue once with the intended target. Verify a failed or interrupted submission is not presented as confirmed.
6. `block_and_unblock`: Check the reported user can be blocked and unblocked and restricted interactions behave as documented. Distinguish this from a global content removal.
7. `moderation_response`: Confirm a responsible responder, monitored intake, prioritization criteria and escalation, plus a documented test report taken through action and audited outcome. A route or inbox alone is not a moderation process.
8. `prohibited_content_enforcement`: Demonstrate the real access controls using a benign fixture classified for denial. Include signed-out and signed-in requests, direct/unlisted app links and playback API/media-token paths, Home/search/Clips/channel, caches, and existing and newly posted items. Confirm moderation denial persists; record remaining exceptions as blockers.
9. `catalog_rights_and_classification`: Review the actual catalog exposed to the app and how incoming works are handled. Retain license, territories, commercial rights, credits, sound/music and age/content classification evidence as applicable. Record actual discrepancies and resolution; uploader declarations alone are not proof.

Repeat affected verification when the actual hosted distribution, configuration or catalog policy changes, even without a deployment SHA change. A SHA match is not proof that server-side settings or catalog state stayed the same. The Data Safety, age/audience and ads declarations, signature acceptance, App Links, privacy and deletion verification are separate release checks.

## Play pre-launch crawler and human sign-in

Record the automated Play pre-launch result separately. Google's crawler does not
inject credentials into web-based WebView authentication. Treat that report as
guest-path evidence for AYIN, not as proof of signed-in behavior. If helpful,
configure up to three previously verified guest deep links with stable content.

Use the nonprivileged test account provided in the Play Console App access
fields to verify the actual installed internal-track build manually. Give
repeatable sign-in steps in English and check them on a fresh install without
staff intervention. Do not add a reviewer bypass or weaken production auth.

See [pre-launch report behavior](https://support.google.com/googleplay/android-developer/answer/9842757)
and [reviewer sign-in details](https://support.google.com/googleplay/android-developer/answer/15748846).

## Local validation

With Python 3.11 or later, work from a secure local directory. Put the evidence record beside the original candidate bundle and `build-metadata.json` from the Android distribution workflow. Record **every** key below as an object with `result: "PASS"` and `evidenceRef` only after the referenced record is actually verified. Opaque IDs may use ASCII letters, digits, dots, underscores and hyphens, length 3–96. Placeholders or PENDING are not acceptance.

Record structure (illustrative only; intentionally fails):

```json
{
  "schemaVersion": 1,
  "applicationId": "net.ayin.app.mobile",
  "buildCommit": "<full build commit from workflow provenance>",
  "bundleSha256": "<SHA-256 of candidate AAB>",
  "hostedRevision": "<independently verified live hosted release SHA>",
  "distributionApproach": "prohibited-content-enforcement",
  "checks": {
    "guest_review_paths": { "result": "PENDING", "evidenceRef": "" },
    "signed_in_review_paths": { "result": "PENDING", "evidenceRef": "" },
    "objectionable_content_policy": { "result": "PENDING", "evidenceRef": "" },
    "ugc_terms_before_upload": { "result": "PENDING", "evidenceRef": "" },
    "report_content_and_users": { "result": "PENDING", "evidenceRef": "" },
    "block_and_unblock": { "result": "PENDING", "evidenceRef": "" },
    "moderation_response": { "result": "PENDING", "evidenceRef": "" },
    "prohibited_content_enforcement": { "result": "PENDING", "evidenceRef": "" },
    "catalog_rights_and_classification": { "result": "PENDING", "evidenceRef": "" }
  }
}
```

```sh
python3 scripts/mobile-android-ugc-evidence.py \
  --evidence /path/to/ugc-review.json \
  --provenance /path/to/build-metadata.json \
  --bundle /path/to/AYIN-release.aab \
  --hosted-revision "$VERIFIED_CURRENT_HOSTED_SHA"
```

Supply the independently read, current deployed web/API revision, not a value copied from the evidence record. If web and API are on different revisions, reconcile them before recording acceptance. Failure means the record must not be used for the public submission decision. Success means the record is structurally complete and matches the provided artifact and release identifiers; it does not authenticate the provenance, verify the signature or inspect the referenced evidence. Keep human review and standard signature verification in the release process.
