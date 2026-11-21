#!/usr/bin/env python3
"""Check recorded Android UGC review evidence, not Play policy compliance."""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

APP_ID = "net.ayin.app.mobile"
CHECKS = (
    "guest_review_paths",
    "signed_in_review_paths",
    "objectionable_content_policy",
    "ugc_terms_before_upload",
    "report_content_and_users",
    "block_and_unblock",
    "moderation_response",
    "prohibited_content_enforcement",
    "catalog_rights_and_classification",
)
SHA = re.compile(r"[a-f0-9]{40}")
REFERENCE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,95}")


def file_sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def json_object(path):
    def unique(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    return value


def check(evidence, provenance, bundle, hosted_revision):
    failures = []
    if not SHA.fullmatch(hosted_revision):
        failures.append("Supply the full, current hosted release SHA.")

    commit = provenance.get("commit")
    if (
        type(provenance.get("schemaVersion")) is not int
        or provenance["schemaVersion"] != 1
        or provenance.get("platform") != "android"
        or provenance.get("environment") != "production"
        or provenance.get("signing") != "distribution"
        or not isinstance(commit, str)
        or not SHA.fullmatch(commit)
    ):
        failures.append("Expected provenance from the signed Android production workflow.")

    digest = file_sha256(bundle)
    artifacts = provenance.get("artifacts")
    matching = (
        [
            item
            for item in artifacts
            if isinstance(item, dict) and item.get("file") == bundle.name
        ]
        if isinstance(artifacts, list)
        else []
    )
    if (
        bundle.suffix != ".aab"
        or len(matching) != 1
        or matching[0].get("sha256") != digest
        or type(matching[0].get("bytes")) is not int
        or matching[0]["bytes"] != bundle.stat().st_size
    ):
        failures.append("The AAB is not uniquely identified by the build provenance.")

    expected = {
        "schemaVersion": 1,
        "applicationId": APP_ID,
        "buildCommit": commit,
        "bundleSha256": digest,
        "hostedRevision": hosted_revision,
        "distributionApproach": "prohibited-content-enforcement",
    }
    if set(evidence) != set(expected) | {"checks"} or any(
        type(evidence.get(key)) is not type(value) or evidence.get(key) != value
        for key, value in expected.items()
    ):
        failures.append("Evidence identity or distribution approach does not match.")

    checks = evidence.get("checks")
    if not isinstance(checks, dict) or set(checks) != set(CHECKS):
        failures.append("Provide exactly the documented UGC evidence checks.")
        checks = checks if isinstance(checks, dict) else {}
    for name in CHECKS:
        entry = checks.get(name)
        if (
            not isinstance(entry, dict)
            or set(entry) != {"result", "evidenceRef"}
            or entry["result"] != "PASS"
            or not isinstance(entry["evidenceRef"], str)
            or not REFERENCE.fullmatch(entry["evidenceRef"])
        ):
            failures.append(f"Missing PASS with an opaque evidence reference: {name}.")
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--hosted-revision", required=True)
    args = parser.parse_args()
    try:
        failures = check(
            json_object(args.evidence), json_object(args.provenance), args.bundle,
            args.hosted_revision,
        )
    except (OSError, ValueError):
        # Don't echo arbitrary JSON contents, paths, or potential secrets into logs.
        failures = ["Could not read a valid evidence/provenance JSON and AAB."]
    if failures:
        for message in failures:
            print(message, file=sys.stderr)
        return 1
    print("UGC evidence record matched the AAB and hosted revision. Inspect the referenced evidence.")
    print("This does not verify a signature, deployed behavior, or Google Play approval.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
