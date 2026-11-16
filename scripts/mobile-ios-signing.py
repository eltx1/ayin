#!/usr/bin/env python3
"""Install ephemeral signing material on a dedicated macOS CI runner.

The workflow calls cleanup unconditionally and never archives this directory.
No certificate, profile contents, private key or passwords are printed.
"""
import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
import uuid as uuid_module

APP_GROUP = 'group.net.ayin.app.ios.sharing'
MAIN_BUNDLE = 'net.ayin.app.ios'
SHARE_BUNDLE = 'net.ayin.app.ios.share'


def validate_profile(details, team, bundle, now=None):
    """Validate decoded owner-supplied profiles without logging their contents."""
    if not isinstance(details, dict) or bundle not in [MAIN_BUNDLE, SHARE_BUNDLE]:
        raise ValueError('Invalid provisioning target or profile')
    entitlements = details.get('Entitlements', {})
    if not isinstance(entitlements, dict):
        raise ValueError('Invalid provisioning entitlements')
    if entitlements.get('application-identifier') != f'{team}.{bundle}':
        raise ValueError('Provisioning profile bundle does not match its AYIN target')
    if bundle == MAIN_BUNDLE and entitlements.get('aps-environment') != 'production':
        raise ValueError('Main provisioning profile must enable production APNs')
    if team not in details.get('TeamIdentifier', []) or entitlements.get('get-task-allow') is not False:
        raise ValueError('Expected an App Store distribution profile from the configured team')
    groups = entitlements.get('com.apple.security.application-groups', [])
    if not isinstance(groups, list) or APP_GROUP not in groups:
        raise ValueError('Both provisioning profiles must enable the AYIN sharing App Group')
    expiration = details.get('ExpirationDate')
    if not isinstance(expiration, datetime) or expiration.replace(tzinfo=timezone.utc) <= (now or datetime.now(timezone.utc)):
        raise ValueError('Provisioning profile expired or missing expiration')
    if details.get('ProvisionedDevices') or details.get('ProvisionsAllDevices'):
        raise ValueError('Expected an App Store profile, not ad hoc or enterprise distribution')
    value = details.get('UUID', '')
    try:
        if str(uuid_module.UUID(value)) != value.lower():
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError('Invalid provisioning UUID') from None
    return value


def profile_cleanup_paths(config, profile_directory):
    """Legacy single-profile state remains readable; never unlink outside Profiles."""
    values = config.get('profiles', [config['profile']] if 'profile' in config else [])
    if not isinstance(values, list):
        raise ValueError('Invalid profile cleanup state')
    output = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError('Invalid profile cleanup target')
        path = Path(value)
        try:
            valid_uuid = str(uuid_module.UUID(path.stem)) == path.stem.lower()
        except ValueError:
            valid_uuid = False
        if path.parent.resolve() != profile_directory.resolve() or path.suffix != '.mobileprovision' or not valid_uuid:
            raise ValueError('Invalid profile cleanup target')
        output.append(path)
    return output


def cleanup_material(root, profile_directory):
    """Attempt every cleanup even if restoring the runner keychain list fails."""
    failed = False
    state = root / 'state.json'
    keychain = root / 'release.keychain-db'
    if state.exists():
        try:
            config = json.loads(state.read_text())
            for profile in profile_cleanup_paths(config, profile_directory):
                profile.unlink(missing_ok=True)
            run('security', 'list-keychains', '-d', 'user', '-s', *config['keychains'])
        except (ValueError, KeyError, OSError, SystemExit, subprocess.SubprocessError):
            failed = True
    if keychain.exists():
        try:
            run('security', 'delete-keychain', str(keychain))
        except (SystemExit, subprocess.SubprocessError):
            failed = True
    shutil.rmtree(root, ignore_errors=True)
    if failed:
        raise SystemExit('Signing cleanup encountered an error; temporary source files were removed (details withheld).')


def run(*args):
    result = subprocess.run(args, capture_output=True, timeout=60)
    if result.returncode:
        raise SystemExit(f'Signing operation failed: {args[0]} {args[1]} (details withheld to protect credentials)')
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['install', 'cleanup'])
    args = parser.parse_args()
    root = Path(os.environ['RUNNER_TEMP']) / 'ayin-signing'
    keychain = root / 'release.keychain-db'
    state = root / 'state.json'
    profile_directory = Path.home() / 'Library/MobileDevice/Provisioning Profiles'
    if args.action == 'cleanup':
        cleanup_material(root, profile_directory)
        return
    root.mkdir(mode=0o700)
    certificate = root / 'certificate.p12'
    certificate.write_bytes(base64.b64decode(os.environ['AYIN_IOS_CERTIFICATE_BASE64'], validate=True))
    team = os.environ['AYIN_IOS_TEAM_ID']
    profiles = {}
    sources = {}
    for bundle, field in [(MAIN_BUNDLE, 'AYIN_IOS_PROFILE_BASE64'), (SHARE_BUNDLE, 'AYIN_IOS_SHARE_PROFILE_BASE64')]:
        source = root / f'{bundle}.mobileprovision'
        source.write_bytes(base64.b64decode(os.environ[field], validate=True))
        details = plistlib.loads(run('security', 'cms', '-D', '-i', str(source)))
        try:
            profile_uuid = validate_profile(details, team, bundle)
        except ValueError as error:
            raise SystemExit(str(error)) from None
        if profile_uuid in profiles.values():
            raise SystemExit('Main and Share extension require distinct provisioning profiles')
        profiles[bundle] = profile_uuid
        sources[profile_uuid] = source
    targets = [profile_directory / f'{value}.mobileprovision' for value in profiles.values()]
    if any(target.exists() for target in targets):
        raise SystemExit('Refusing to overwrite an existing provisioning profile on this runner')
    profile_directory.mkdir(parents=True, exist_ok=True)
    keychains = [line.strip().strip('"') for line in run('security', 'list-keychains', '-d', 'user').decode().splitlines() if line.strip()]
    state.write_text(json.dumps({'profiles': [str(target) for target in targets], 'keychains': keychains}))
    for target in targets:
        target.write_bytes(sources[target.stem].read_bytes())
    password = secrets.token_urlsafe(32)
    run('security', 'create-keychain', '-p', password, str(keychain))
    run('security', 'set-keychain-settings', '-lut', '3600', str(keychain))
    run('security', 'unlock-keychain', '-p', password, str(keychain))
    run('security', 'import', str(certificate), '-P', os.environ['AYIN_IOS_CERTIFICATE_PASSWORD'], '-k', str(keychain), '-T', '/usr/bin/codesign')
    run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, str(keychain))
    run('security', 'list-keychains', '-d', 'user', '-s', str(keychain), *keychains)
    export = {'method': 'app-store-connect', 'teamID': team, 'signingStyle': 'manual', 'signingCertificate': 'Apple Distribution', 'provisioningProfiles': profiles, 'uploadSymbols': False, 'manageAppVersionAndBuildNumber': False}
    (root / 'ExportOptions.plist').write_bytes(plistlib.dumps(export))
    with open(os.environ['GITHUB_ENV'], 'a') as output:
        output.write(f'AYIN_IOS_PROFILE_UUID={profiles[MAIN_BUNDLE]}\n')
        output.write(f'AYIN_IOS_SHARE_PROFILE_UUID={profiles[SHARE_BUNDLE]}\n')
    print('Installed temporary distribution signing material; no upload or store submission performed.')


if __name__ == '__main__':
    main()
