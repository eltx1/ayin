#!/usr/bin/env python3
"""Security-focused tests for release config and 16 KB binary acceptance gates."""
import base64
import importlib.util
import os
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import plistlib
import struct
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


config = load('mobile_release_config', 'mobile-release-config.py')
page_size = load('mobile_page_size', 'mobile-android-page-size.py')


class ReleaseConfigurationTests(unittest.TestCase):
    def base(self):
        return {
            'AYIN_VERSION_CODE': '2', 'AYIN_VERSION_NAME': '1.1.0',
            'AYIN_ADMOB_ANDROID_APP_ID': 'ca-app-pub-0000000000000000~0000000000',
            'AYIN_FIREBASE_ANDROID_APP_ID': '1:123456789:android:abcdef',
            'AYIN_FIREBASE_PROJECT_ID': 'ayin-test-fixture',
            'AYIN_FIREBASE_API_KEY': 'AIza' + ('a' * 35),
            'AYIN_FIREBASE_SENDER_ID': '123456789',
        }

    def test_empty_environment_fails_before_build(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ValueError, 'AYIN_VERSION_CODE'):
            config.validate('android')

    def test_injected_or_non_integer_version_is_rejected(self):
        for value in ['1\nsecret', '0', '-1', '1.0', '9999999999']:
            with patch.dict(os.environ, {**self.base(), 'AYIN_VERSION_CODE': value}, clear=True), self.assertRaises(ValueError):
                config.validate('android')

    def test_google_test_app_id_cannot_be_released(self):
        with patch.dict(os.environ, {**self.base(), 'AYIN_ADMOB_ANDROID_APP_ID': 'ca-app-pub-3940256099942544~3347511713'}, clear=True), self.assertRaisesRegex(ValueError, 'Google sample'):
            config.validate('android')

    def test_unsigned_config_does_not_require_private_key(self):
        with patch.dict(os.environ, self.base(), clear=True):
            self.assertIsNone(config.validate('android'))

    def test_android_json_maps_only_configured_client_values(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'google-services.json'
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('mobile-release-config.py')), 'android', '--firebase-json', str(output)], env=self.base(), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            generated = json.loads(output.read_text())
            self.assertEqual(generated['client'][0]['client_info']['android_client_info']['package_name'], 'net.ayin.app.mobile')
            self.assertEqual(generated['project_info']['project_number'], self.base()['AYIN_FIREBASE_SENDER_ID'])
            self.assertEqual(generated['client'][0]['api_key'][0]['current_key'], self.base()['AYIN_FIREBASE_API_KEY'])
            self.assertNotIn(self.base()['AYIN_FIREBASE_API_KEY'], result.stdout + result.stderr)

    def test_signed_config_requires_key(self):
        with patch.dict(os.environ, self.base(), clear=True), self.assertRaisesRegex(ValueError, 'AYIN_ANDROID_KEYSTORE_BASE64'):
            config.validate('android', signed=True)

    def test_ios_plist_must_match_existing_bundle(self):
        fields = {**self.base(), 'AYIN_ADMOB_IOS_APP_ID': 'ca-app-pub-0000000000000000~0000000000'}
        fields['AYIN_IOS_FIREBASE_PLIST_BASE64'] = base64.b64encode(plistlib.dumps({'BUNDLE_ID': 'some.other.app'})).decode()
        with patch.dict(os.environ, fields, clear=True), self.assertRaisesRegex(ValueError, 'BUNDLE_ID'):
            config.validate('ios')

    def test_invalid_plist_never_echoes_encoded_content(self):
        fields = {**self.base(), 'AYIN_ADMOB_IOS_APP_ID': 'ca-app-pub-0000000000000000~0000000000', 'AYIN_IOS_FIREBASE_PLIST_BASE64': 'SECRET_DO_NOT_PRINT'}
        with patch.dict(os.environ, fields, clear=True), self.assertRaisesRegex(ValueError, '^Invalid AYIN_IOS_FIREBASE_PLIST_BASE64$'):
            config.validate('ios')


class AndroidPageSizeTests(unittest.TestCase):
    def elf(self, alignment, address=0):
        data = bytearray(120)
        data[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<Q', data, 32, 64)
        struct.pack_into('<HH', data, 54, 56, 1)
        struct.pack_into('<I', data, 64, 1)
        struct.pack_into('<QQ', data, 72, 0, address)
        struct.pack_into('<Q', data, 112, alignment)
        return data

    def test_rejects_4k_alignment(self):
        self.assertEqual(len(page_size.alignment_errors(self.elf(4096))), 1)

    def test_accepts_16k_alignment(self):
        self.assertEqual(page_size.alignment_errors(self.elf(16384)), [])

    def test_rejects_misaligned_segment_address(self):
        self.assertEqual(len(page_size.alignment_errors(self.elf(16384, 4096))), 1)

    def test_rejects_empty_program_headers(self):
        data = self.elf(16384)
        struct.pack_into('<H', data, 56, 0)
        self.assertTrue(page_size.alignment_errors(data))

    def test_rejects_truncated_headers(self):
        self.assertTrue(page_size.alignment_errors(self.elf(16384)[:100]))


if __name__ == '__main__':
    unittest.main()
