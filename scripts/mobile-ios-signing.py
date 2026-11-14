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
import subprocess


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
    if args.action == 'cleanup':
        if state.exists():
            config = json.loads(state.read_text())
            Path(config['profile']).unlink(missing_ok=True)
            run('security', 'list-keychains', '-d', 'user', '-s', *config['keychains'])
        if keychain.exists():
            run('security', 'delete-keychain', str(keychain))
        import shutil
        shutil.rmtree(root, ignore_errors=True)
        return
    root.mkdir(mode=0o700)
    certificate = root / 'certificate.p12'
    profile = root / 'profile.mobileprovision'
    certificate.write_bytes(base64.b64decode(os.environ['AYIN_IOS_CERTIFICATE_BASE64'], validate=True))
    profile.write_bytes(base64.b64decode(os.environ['AYIN_IOS_PROFILE_BASE64'], validate=True))
    details = plistlib.loads(run('security', 'cms', '-D', '-i', str(profile)))
    entitlements = details.get('Entitlements', {})
    team = os.environ['AYIN_IOS_TEAM_ID']
    if entitlements.get('application-identifier') != f'{team}.net.ayin.app.ios' or entitlements.get('aps-environment') != 'production':
        raise SystemExit('Provisioning profile must target the AYIN bundle and production APNs')
    if team not in details.get('TeamIdentifier', []) or entitlements.get('get-task-allow') is not False:
        raise SystemExit('Expected a distribution provisioning profile from the configured team')
    expiration = details.get('ExpirationDate')
    if expiration is None or expiration.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        raise SystemExit('Provisioning profile expired or missing expiration')
    if details.get('ProvisionedDevices') or details.get('ProvisionsAllDevices'):
        raise SystemExit('Expected an App Store distribution profile')
    uuid = details.get('UUID', '')
    import re
    if not re.fullmatch(r'[A-Fa-f0-9-]{36}', uuid):
        raise SystemExit('Invalid provisioning UUID')
    target = Path.home() / 'Library/MobileDevice/Provisioning Profiles' / f'{uuid}.mobileprovision'
    target.parent.mkdir(parents=True, exist_ok=True)
    keychains = [line.strip().strip('"') for line in run('security', 'list-keychains', '-d', 'user').decode().splitlines() if line.strip()]
    state.write_text(json.dumps({'profile': str(target), 'keychains': keychains}))
    target.write_bytes(profile.read_bytes())
    password = secrets.token_urlsafe(32)
    run('security', 'create-keychain', '-p', password, str(keychain))
    run('security', 'set-keychain-settings', '-lut', '3600', str(keychain))
    run('security', 'unlock-keychain', '-p', password, str(keychain))
    run('security', 'import', str(certificate), '-P', os.environ['AYIN_IOS_CERTIFICATE_PASSWORD'], '-k', str(keychain), '-T', '/usr/bin/codesign')
    run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, str(keychain))
    run('security', 'list-keychains', '-d', 'user', '-s', str(keychain), *keychains)
    export = {'method': 'app-store-connect', 'teamID': team, 'signingStyle': 'manual', 'signingCertificate': 'Apple Distribution', 'provisioningProfiles': {'net.ayin.app.ios': uuid}, 'uploadSymbols': False, 'manageAppVersionAndBuildNumber': False}
    (root / 'ExportOptions.plist').write_bytes(plistlib.dumps(export))
    with open(os.environ['GITHUB_ENV'], 'a') as output:
        output.write(f'AYIN_IOS_PROFILE_UUID={uuid}\n')
    print('Installed temporary distribution signing material; no upload or store submission performed.')


if __name__ == '__main__':
    main()
