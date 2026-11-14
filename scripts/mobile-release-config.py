#!/usr/bin/env python3
"""Fail closed for a configured mobile release; print field names, never values."""
import argparse
import base64
import os
import json
from pathlib import Path
import plistlib
import re


def require(name, pattern=None):
    value = os.environ.get(name, '').strip()
    if not value:
        raise ValueError(f'Missing {name}')
    if pattern and not re.fullmatch(pattern, value):
        raise ValueError(f'Invalid {name}')
    return value


def validate(platform, signed=False):
    require('AYIN_VERSION_CODE', r'[1-9][0-9]{0,8}')
    require('AYIN_VERSION_NAME', r'[0-9]+\.[0-9]+\.[0-9]+')
    app_id = require(f'AYIN_ADMOB_{platform.upper()}_APP_ID', r'ca-app-pub-[0-9]{16}~[0-9]{10}')
    if app_id.startswith('ca-app-pub-3940256099942544~'):
        raise ValueError('Release must use the owner-configured App ID, not a Google sample App ID')
    if platform == 'android':
        require('AYIN_FIREBASE_ANDROID_APP_ID', r'1:[0-9]+:android:[a-fA-F0-9]+')
        require('AYIN_FIREBASE_API_KEY', r'AIza[A-Za-z0-9_-]{35}')
        require('AYIN_FIREBASE_PROJECT_ID', r'[a-z][a-z0-9-]{4,28}[a-z0-9]')
        require('AYIN_FIREBASE_SENDER_ID', r'[0-9]+')
        if signed:
            for key in ['AYIN_ANDROID_KEYSTORE_BASE64', 'AYIN_ANDROID_KEYSTORE_PASSWORD', 'AYIN_ANDROID_KEY_ALIAS', 'AYIN_ANDROID_KEY_PASSWORD']:
                require(key)
    else:
        try:
            data = base64.b64decode(require('AYIN_IOS_FIREBASE_PLIST_BASE64'), validate=True)
            config = plistlib.loads(data)
        except Exception as exc:
            raise ValueError('Invalid AYIN_IOS_FIREBASE_PLIST_BASE64') from exc
        if config.get('BUNDLE_ID') != 'net.ayin.app.ios':
            raise ValueError('Firebase plist BUNDLE_ID must match net.ayin.app.ios')
        for key in ['GOOGLE_APP_ID', 'GCM_SENDER_ID', 'API_KEY', 'PROJECT_ID']:
            if not isinstance(config.get(key), str) or not config[key]:
                raise ValueError(f'Firebase plist missing {key}')
        if not re.fullmatch(r'1:[0-9]+:ios:[a-fA-F0-9]+', config['GOOGLE_APP_ID']):
            raise ValueError('Firebase plist has invalid GOOGLE_APP_ID')
        if signed:
            require('AYIN_IOS_TEAM_ID', r'[A-Z0-9]{10}')
            for key in ['AYIN_IOS_CERTIFICATE_BASE64', 'AYIN_IOS_CERTIFICATE_PASSWORD', 'AYIN_IOS_PROFILE_BASE64']:
                require(key)
        return data
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('platform', choices=['android', 'ios'])
    parser.add_argument('--signed', action='store_true')
    parser.add_argument('--firebase-plist', type=Path)
    parser.add_argument('--firebase-json', type=Path)
    args = parser.parse_args()
    try:
        plist = validate(args.platform, args.signed)
        if args.firebase_plist and plist:
            args.firebase_plist.parent.mkdir(parents=True, exist_ok=True)
            args.firebase_plist.write_bytes(plist)
        if args.firebase_json and args.platform == 'android':
            config = {
                'project_info': {
                    'project_number': os.environ['AYIN_FIREBASE_SENDER_ID'],
                    'project_id': os.environ['AYIN_FIREBASE_PROJECT_ID'],
                },
                'client': [{
                    'client_info': {
                        'mobilesdk_app_id': os.environ['AYIN_FIREBASE_ANDROID_APP_ID'],
                        'android_client_info': {'package_name': 'net.ayin.app.mobile'},
                    },
                    'api_key': [{'current_key': os.environ['AYIN_FIREBASE_API_KEY']}],
                }],
                'configuration_version': '1',
            }
            args.firebase_json.parent.mkdir(parents=True, exist_ok=True)
            args.firebase_json.write_text(json.dumps(config) + '\n')
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    print(f'{args.platform} release configuration fields validated; external account validity remains a device/release check.')


if __name__ == '__main__':
    main()
