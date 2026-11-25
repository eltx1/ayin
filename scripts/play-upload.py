#!/usr/bin/env python3
"""Upload a signed Android App Bundle to Google Play as a DRAFT release.

The release is never sent for review or rolled out here: an owner reviews the draft in
Play Console and submits it. Other non-draft releases already on the track are kept.

Environment:
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  service-account key JSON with Play release permission
Arguments:
  --package net.ayin.app.mobile --track internal|alpha|beta|production
  --aab path [--mapping path] --release-name "1.1.0 (7)"
"""

import argparse
import json
import os
import sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"


def fail(message: str, response=None) -> None:
    detail = ""
    if response is not None:
        try:
            detail = json.dumps(response.json().get("error", {}), ensure_ascii=False)
        except ValueError:
            detail = response.text[:2000]
    print(f"::error::{message} {detail}".strip(), file=sys.stderr)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--track", required=True, choices=["internal", "alpha", "beta", "production"])
    parser.add_argument("--aab", required=True)
    parser.add_argument("--mapping")
    parser.add_argument("--release-name", required=True)
    args = parser.parse_args()

    raw = os.environ.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        fail("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured in the mobile-production environment.")
    try:
        info = json.loads(raw)
    except json.JSONDecodeError:
        fail("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON (paste the whole key file).")
    credentials = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/androidpublisher"]
    )
    session = AuthorizedSession(credentials)
    print(f"Service account: {info.get('client_email')}")

    app = f"{API}/{args.package}"
    response = session.post(f"{app}/edits", json={})
    if not response.ok:
        fail("Could not open a Play edit (check that the service account was invited to this app).", response)
    edit = response.json()["id"]

    with open(args.aab, "rb") as bundle:
        response = session.post(
            f"{UPLOAD}/{args.package}/edits/{edit}/bundles",
            params={"uploadType": "media"},
            headers={"Content-Type": "application/octet-stream"},
            data=bundle,
            timeout=900,
        )
    if not response.ok:
        fail("Play rejected the app bundle.", response)
    version_code = response.json()["versionCode"]
    print(f"Uploaded bundle versionCode={version_code}")

    if args.mapping and os.path.getsize(args.mapping) > 0:
        with open(args.mapping, "rb") as mapping:
            response = session.post(
                f"{UPLOAD}/{args.package}/edits/{edit}/apks/{version_code}/deobfuscationFiles/proguard",
                params={"uploadType": "media"},
                headers={"Content-Type": "application/octet-stream"},
                data=mapping,
                timeout=600,
            )
        if not response.ok:
            fail("Play rejected the R8 mapping file.", response)
        print("Uploaded R8 mapping for crash deobfuscation")

    response = session.get(f"{app}/edits/{edit}/tracks/{args.track}")
    existing = response.json().get("releases", []) if response.ok else []
    kept = [release for release in existing if release.get("status") != "draft"]
    draft = {"name": args.release_name, "versionCodes": [str(version_code)], "status": "draft"}
    response = session.put(
        f"{app}/edits/{edit}/tracks/{args.track}",
        json={"track": args.track, "releases": [*kept, draft]},
    )
    if not response.ok:
        fail(f"Could not place the draft release on the {args.track} track.", response)

    response = session.post(f"{app}/edits/{edit}:commit")
    if not response.ok and "changesNotSentForReview" in response.text:
        response = session.post(
            f"{app}/edits/{edit}:commit", params={"changesNotSentForReview": "true"}
        )
    if not response.ok:
        fail("Play did not accept the edit.", response)
    print(
        f"Draft release '{args.release_name}' (versionCode {version_code}) is on the "
        f"{args.track} track. Review it in Play Console and send it for review."
    )


if __name__ == "__main__":
    main()
