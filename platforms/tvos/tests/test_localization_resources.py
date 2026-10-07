"""Portable catalog checks; the tvOS XCTest suite verifies the built app bundle."""

import json
from pathlib import Path
import plistlib
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "AYINTV"
QUOTED = r'"(?:[^"\\]|\\.)*"'
ENTRY = re.compile(rf"({QUOTED})\s*=\s*({QUOTED});")
FORMAT = re.compile(r"%[0-9]*[d@]")


def read_strings(language):
    path = APP / "Localization" / f"{language}.lproj" / "Localizable.strings"
    entries = {}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip() or line.startswith("/*"):
            continue
        match = ENTRY.fullmatch(line)
        if not match:
            raise AssertionError(f"Invalid .strings entry: {path}:{number}")
        key, value = (json.loads(token) for token in match.groups())
        if key in entries:
            raise AssertionError(f"Duplicate localization key: {path}:{number}: {key}")
        entries[key] = value
    return entries


class TVLocalizationResourceTests(unittest.TestCase):
    def test_catalogs_match_and_preserve_english_fallbacks(self):
        english, arabic = read_strings("en"), read_strings("ar")
        self.assertEqual(english.keys(), arabic.keys())
        self.assertGreater(len(english), 60)
        for key in english:
            with self.subTest(key=key):
                self.assertEqual(english[key], key)
                self.assertTrue(arabic[key].strip())
                self.assertNotEqual(arabic[key], key)
                self.assertRegex(arabic[key], "[\u0600-\u06ff]")
                self.assertEqual(FORMAT.findall(key), FORMAT.findall(arabic[key]))
                self.assertNotIn("%", FORMAT.sub("", arabic[key]))

    def test_native_literal_labels_and_explicit_lookups_have_resources(self):
        keys = set(read_strings("en"))
        labels = re.compile(
            rf"\b(?:Text|Label|Button|ProgressView|Section|ContentUnavailableView|navigationTitle|TVStrings\.text)"
            rf"\(\s*({QUOTED})"
        )
        discovered = set()
        for path in APP.rglob("*.swift"):
            for literal in labels.findall(path.read_text()):
                if "\\(" in literal:  # Source-owned interpolated titles/identifiers.
                    continue
                key = json.loads(literal)
                discovered.add(key)
                self.assertIn(key, keys, f"Missing resource used by {path.relative_to(ROOT)}")
        self.assertGreater(len(discovered), 40)

        helper = (APP / "Localization" / "TVStrings.swift").read_text()
        # Include both arms of dynamic text(...) choices and all numeric formats.
        for arguments in re.findall(r"\btext\((.*?)bundle:", helper):
            for literal in re.findall(QUOTED, arguments):
                key = json.loads(literal)
                if key != "HLS":  # Media protocol compared before selecting a label.
                    self.assertIn(key, keys)

    def test_uikit_menu_titles_require_explicit_localization(self):
        controller = (APP / "Player" / "TVPlayerController.swift").read_text()
        for literal in re.findall(rf"\b(?:UIAction|UIMenu)\(\s*title:\s*({QUOTED})", controller):
            if "\\(" not in literal:
                self.fail(f"UIKit does not localize literal titles automatically: {literal}")
        self.assertTrue({"Off", "Subtitles", "Chapters", "Next Episode"}.issubset(read_strings("ar")))

    def test_shared_foundation_error_resources_are_available_to_tvos(self):
        required = {
            "This AYIN stream is not available right now.", "AYIN returned an invalid media URL.",
            "AYIN returned an invalid response.", "AYIN could not build a secure request URL.", "AYIN request failed.",
            "AYIN is still restoring your session. Try again in a moment.",
            "Enter either an authenticator code or a recovery code.",
            "AYIN could not access your saved session securely. Try again.",
            "AYIN could not read your saved session. Sign in again.",
        }
        # Shared iOS files are included by the tvOS target. Their lookups use this
        # app's bundle, and newly added shared errors must be translated here too.
        project = (ROOT / "project.yml").read_text()
        for relative in re.findall(r"- path: (\.\./ios/[^\n]+\.swift)", project):
            source = (ROOT / relative).read_text()
            required.update(json.loads(key) for key in re.findall(rf"NSLocalizedString\(\s*({QUOTED})", source))
        self.assertTrue(required.issubset(read_strings("en")))
        self.assertTrue(required.issubset(read_strings("ar")))

    def test_xcodegen_includes_localized_sources_and_declares_english_fallback(self):
        project = (ROOT / "project.yml").read_text()
        self.assertIn("- path: AYINTV\n", project)
        self.assertNotRegex(project, r"(?m)^\s+- (?:Localization|\*\.lproj|\*\.strings)\s*$")
        with (APP / "Info.plist").open("rb") as source:
            self.assertEqual(plistlib.load(source)["CFBundleDevelopmentRegion"], "en")
        self.assertEqual({path.parent.name for path in APP.rglob("Localizable.strings")}, {"en.lproj", "ar.lproj"})


if __name__ == "__main__":
    unittest.main()
