#!/usr/bin/env python3
"""Regression tests for the Android UGC evidence contract."""

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("mobile-android-ugc-evidence.py")
BUILD = "a" * 40
HOST = "b" * 40
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


class UgcEvidenceTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        home = Path(temp.name)
        self.bundle = home / "AYIN-release.aab"
        bundle_bytes = b"fake test artifact"
        self.bundle.write_bytes(bundle_bytes)
        self.digest = hashlib.sha256(bundle_bytes).hexdigest()
        self.evidence_path = home / "review.json"
        self.provenance_path = home / "build-metadata.json"
        self.evidence = {
            "schemaVersion": 1,
            "applicationId": "net.ayin.app.mobile",
            "buildCommit": BUILD,
            "bundleSha256": self.digest,
            "hostedRevision": HOST,
            "distributionApproach": "prohibited-content-enforcement",
            "checks": {
                name: {"result": "PASS", "evidenceRef": f"record-{name}"}
                for name in CHECKS
            },
        }
        self.provenance = {
            "schemaVersion": 1, "platform": "android", "environment": "production",
            "signing": "distribution", "commit": BUILD,
            "artifacts": [
                {"file": self.bundle.name, "sha256": self.digest, "bytes": len(bundle_bytes)},
                {"file": "mapping.txt"},
            ],
        }

    def check(self, hosted=HOST, evidence_raw=None):
        self.evidence_path.write_text(
            json.dumps(self.evidence) if evidence_raw is None else evidence_raw
        )
        self.provenance_path.write_text(json.dumps(self.provenance))
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--evidence", str(self.evidence_path),
             "--provenance", str(self.provenance_path), "--bundle", str(self.bundle),
             "--hosted-revision", hosted],
            capture_output=True, text=True, check=False,
        )

    def test_complete_record_is_consistent_not_policy_approval(self):
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("does not verify", result.stdout)

    def test_moving_hosted_release_invalidates_evidence(self):
        self.assertNotEqual(self.check("c" * 40).returncode, 0)

    def test_changed_build_and_artifact(self):
        self.provenance["commit"] = "d" * 40
        self.assertNotEqual(self.check().returncode, 0)
        self.provenance["commit"] = BUILD
        self.bundle.write_bytes(b"changed test artifact")
        self.assertNotEqual(self.check().returncode, 0)

    def test_unsigned_wrong_platform_duplicates_and_bad_fingerprint(self):
        original = copy.deepcopy(self.provenance)
        for key, value in (
            ("signing", "unsigned"),
            ("platform", "ios"),
            ("environment", "development"),
            ("artifacts", [original["artifacts"][0]] * 2),
            ("artifacts", [{**original["artifacts"][0], "sha256": "x" * 64}]),
        ):
            with self.subTest(key=key, value=value):
                self.provenance = {**original, key: value}
                self.assertNotEqual(self.check().returncode, 0)

    def test_missing_failed_unknown_and_invalid_record_references(self):
        original = copy.deepcopy(self.evidence["checks"])
        name = "moderation_response"
        for entry in (
            None,
            {"result": "PENDING", "evidenceRef": "record-123"},
            {"result": "PASS", "evidenceRef": "https://private.example/token"},
            {"result": "PASS", "evidenceRef": "review-123", "unexpected": True},
        ):
            with self.subTest(entry=entry):
                self.evidence["checks"] = copy.deepcopy(original)
                if entry is None:
                    del self.evidence["checks"][name]
                else:
                    self.evidence["checks"][name] = entry
                result = self.check()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)
        self.evidence["checks"] = {**original, "unknown": original[name]}
        self.assertNotEqual(self.check().returncode, 0)

    def test_rejects_extra_fields_and_noncanonical_identifiers(self):
        self.evidence["untracked"] = "unexpected-metadata"
        result = self.check()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("unexpected-metadata", result.stderr)
        del self.evidence["untracked"]
        self.assertNotEqual(self.check("b" * 7).returncode, 0)
        self.evidence["applicationId"] = "net.ayin.app"
        self.assertNotEqual(self.check().returncode, 0)

    def test_18_plus_metadata_is_not_an_enforcement_strategy(self):
        self.evidence["distributionApproach"] = "18-plus-labels"
        self.assertNotEqual(self.check().returncode, 0)

    def test_duplicate_and_invalid_json_rejected_without_echoing_input(self):
        raw = '{"test-secret":{"a":1,"a":2}}'
        result = self.check(evidence_raw=raw)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("test-secret", result.stderr)
        self.assertNotEqual(self.check(evidence_raw="[]").returncode, 0)

    def test_missing_artifact_rejected(self):
        self.bundle.unlink()
        self.assertNotEqual(self.check().returncode, 0)


if __name__ == "__main__":
    unittest.main()
