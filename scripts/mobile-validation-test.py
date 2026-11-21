#!/usr/bin/env python3
"""Security-focused tests for release config and 16 KB binary acceptance gates."""
import base64
from datetime import datetime, timedelta, timezone
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
ios_signing = load('mobile_ios_signing', 'mobile-ios-signing.py')


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

    def test_android_rejects_cross_project_firebase_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'google-services.json'
            fields = {**self.base(), 'AYIN_FIREBASE_SENDER_ID': '987654321'}
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name('mobile-release-config.py')),
                 'android', '--firebase-json', str(output)],
                env=fields, capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('must belong to the same Firebase project', result.stderr)
            self.assertFalse(output.exists())
            for name in ('AYIN_FIREBASE_SENDER_ID', 'AYIN_FIREBASE_ANDROID_APP_ID', 'AYIN_FIREBASE_API_KEY'):
                self.assertNotIn(fields[name], result.stdout + result.stderr)

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

    def test_signed_ios_requires_separate_share_extension_profile(self):
        plist = {'BUNDLE_ID': 'net.ayin.app.ios', 'GOOGLE_APP_ID': '1:123456789:ios:abcdef',
                 'GCM_SENDER_ID': '123456789', 'API_KEY': 'fixture-client-id', 'PROJECT_ID': 'ayin-test-fixture'}
        fields = {**self.base(), 'AYIN_ADMOB_IOS_APP_ID': self.base()['AYIN_ADMOB_ANDROID_APP_ID'],
                  'AYIN_IOS_FIREBASE_PLIST_BASE64': base64.b64encode(plistlib.dumps(plist)).decode(),
                  'AYIN_IOS_TEAM_ID': 'TESTTEAM01', 'AYIN_IOS_CERTIFICATE_BASE64': 'fixture',
                  'AYIN_IOS_CERTIFICATE_PASSWORD': 'fixture', 'AYIN_IOS_PROFILE_BASE64': 'fixture'}
        with patch.dict(os.environ, fields, clear=True), self.assertRaisesRegex(ValueError, 'Missing AYIN_IOS_SHARE_PROFILE_BASE64'):
            config.validate('ios', signed=True)
        with patch.dict(os.environ, {**fields, 'AYIN_IOS_SHARE_PROFILE_BASE64': 'fixture'}, clear=True):
            self.assertEqual(plistlib.loads(config.validate('ios', signed=True)), plist)


class IOSSigningTests(unittest.TestCase):
    main_uuid = '11111111-1111-4111-8111-111111111111'
    share_uuid = '22222222-2222-4222-8222-222222222222'
    team = 'TESTTEAM01'
    now = datetime(2026, 11, 14, tzinfo=timezone.utc)

    def profile(self, bundle):
        entitlements = {'application-identifier': f'{self.team}.{bundle}', 'get-task-allow': False,
                        'com.apple.security.application-groups': [ios_signing.APP_GROUP]}
        if bundle == ios_signing.MAIN_BUNDLE:
            entitlements['aps-environment'] = 'production'
        return {'Entitlements': entitlements, 'TeamIdentifier': [self.team],
                'UUID': self.main_uuid if bundle == ios_signing.MAIN_BUNDLE else self.share_uuid,
                'ExpirationDate': (self.now + timedelta(days=30)).replace(tzinfo=None)}

    def test_distinct_main_and_share_app_store_profiles_are_accepted(self):
        for bundle in [ios_signing.MAIN_BUNDLE, ios_signing.SHARE_BUNDLE]:
            profile = self.profile(bundle)
            self.assertEqual(ios_signing.validate_profile(profile, self.team, bundle, self.now), profile['UUID'])

    def test_profiles_cannot_be_swapped_between_targets(self):
        with self.assertRaisesRegex(ValueError, 'bundle'):
            ios_signing.validate_profile(self.profile(ios_signing.MAIN_BUNDLE), self.team, ios_signing.SHARE_BUNDLE, self.now)

    def test_both_profiles_require_matching_app_group(self):
        for bundle in [ios_signing.MAIN_BUNDLE, ios_signing.SHARE_BUNDLE]:
            profile = self.profile(bundle)
            profile['Entitlements']['com.apple.security.application-groups'] = ['group.some.other.app']
            with self.assertRaisesRegex(ValueError, 'App Group'):
                ios_signing.validate_profile(profile, self.team, bundle, self.now)

    def test_wrong_team_development_expired_and_invalid_uuid_are_rejected(self):
        for mutation in [
            lambda value: value.update(TeamIdentifier=['OTHERTEAM1']),
            lambda value: value['Entitlements'].update({'get-task-allow': True}),
            lambda value: value['Entitlements'].update({'aps-environment': 'development'}),
            lambda value: value.update(ProvisionedDevices=['fixture-device']),
            lambda value: value.update(ProvisionsAllDevices=True),
            lambda value: value.update(ExpirationDate=self.now.replace(tzinfo=None)),
            lambda value: value.update(UUID='../not-a-profile'),
        ]:
            profile = self.profile(ios_signing.MAIN_BUNDLE)
            mutation(profile)
            with self.assertRaises(ValueError):
                ios_signing.validate_profile(profile, self.team, ios_signing.MAIN_BUNDLE, self.now)

    def test_cleanup_accepts_legacy_state_and_refuses_outside_targets(self):
        directory = Path('/fixture/Library/MobileDevice/Provisioning Profiles')
        main = directory / f'{self.main_uuid}.mobileprovision'
        share = directory / f'{self.share_uuid}.mobileprovision'
        self.assertEqual(ios_signing.profile_cleanup_paths({'profile': str(main)}, directory), [main])
        self.assertEqual(ios_signing.profile_cleanup_paths({'profiles': [str(main), str(share)]}, directory), [main, share])
        for invalid in ['/some/other/file.mobileprovision', str(directory / '../outside.mobileprovision'),
                        str(directory / 'arbitrary.mobileprovision'), str(directory / f'{self.main_uuid}.txt'), None]:
            with self.assertRaises(ValueError):
                ios_signing.profile_cleanup_paths({'profiles': [invalid]}, directory)

    def test_cleanup_continues_after_keychain_restore_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'ayin-signing'; root.mkdir()
            profiles = Path(directory) / 'profiles'; profiles.mkdir()
            paths = [profiles / f'{value}.mobileprovision' for value in [self.main_uuid, self.share_uuid]]
            for path in paths:
                path.write_bytes(b'fixture')
            (root / 'release.keychain-db').write_bytes(b'fixture')
            (root / 'certificate.p12').write_bytes(b'fixture')
            (root / 'state.json').write_text(json.dumps({'profiles': [str(path) for path in paths], 'keychains': ['login.keychain-db']}))
            calls = []
            def fake_run(*args):
                calls.append(args)
                if args[1] == 'list-keychains':
                    raise SystemExit('fixture failure')
            with patch.object(ios_signing, 'run', side_effect=fake_run), self.assertRaisesRegex(SystemExit, 'cleanup'):
                ios_signing.cleanup_material(root, profiles)
            self.assertFalse(root.exists())
            self.assertTrue(all(not path.exists() for path in paths))
            self.assertTrue(any(args[1] == 'delete-keychain' for args in calls))

    def test_install_exports_both_target_profiles_and_never_logs_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = Path(directory) / 'runner'; runner.mkdir()
            user = Path(directory) / 'user'; user.mkdir()
            github_env = Path(directory) / 'github-env'
            environment = {'RUNNER_TEMP': str(runner), 'GITHUB_ENV': str(github_env), 'AYIN_IOS_TEAM_ID': self.team,
                           'AYIN_IOS_CERTIFICATE_BASE64': base64.b64encode(b'fixture-certificate').decode(),
                           'AYIN_IOS_CERTIFICATE_PASSWORD': 'fixture-password',
                           'AYIN_IOS_PROFILE_BASE64': base64.b64encode(b'fixture-main-profile').decode(),
                           'AYIN_IOS_SHARE_PROFILE_BASE64': base64.b64encode(b'fixture-share-profile').decode()}
            def fake_run(*args):
                if args[1] == 'cms':
                    bundle = Path(args[-1]).stem
                    # Profile validity in this fixture is independent of the real clock.
                    profile = self.profile(bundle); profile['ExpirationDate'] = datetime(2099, 1, 1)
                    return plistlib.dumps(profile)
                if args[1] == 'list-keychains' and '-s' not in args:
                    return b'"/fixture/login.keychain-db"\n'
                return b''
            with patch.dict(os.environ, environment, clear=True), patch.object(sys, 'argv', ['mobile-ios-signing.py', 'install']), \
                 patch.object(ios_signing.Path, 'home', return_value=user), patch.object(ios_signing, 'run', side_effect=fake_run), \
                 patch('builtins.print') as printer:
                ios_signing.main()
            root = runner / 'ayin-signing'
            export = plistlib.loads((root / 'ExportOptions.plist').read_bytes())
            self.assertEqual(export['provisioningProfiles'], {ios_signing.MAIN_BUNDLE: self.main_uuid, ios_signing.SHARE_BUNDLE: self.share_uuid})
            self.assertEqual(len(json.loads((root / 'state.json').read_text())['profiles']), 2)
            self.assertIn(f'AYIN_IOS_PROFILE_UUID={self.main_uuid}', github_env.read_text())
            self.assertIn(f'AYIN_IOS_SHARE_PROFILE_UUID={self.share_uuid}', github_env.read_text())
            self.assertNotIn('fixture-password', str(printer.call_args_list))


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
