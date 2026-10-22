#!/usr/bin/env python3
"""Record reproducible build provenance without serializing the environment/secrets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone


def command(*args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=30, check=False)
        return (result.stdout + result.stderr).strip() if result.returncode == 0 else None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['android', 'ios'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--artifact', action='append', type=Path, default=[])
    parser.add_argument('--signing', choices=['debug', 'unsigned', 'distribution'], required=True)
    args = parser.parse_args()
    artifacts = []
    for path in args.artifact:
        if not path.is_file():
            raise SystemExit(f'Missing expected artifact: {path}')
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        digest = digest.hexdigest()
        artifacts.append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest})
    payload = {
        'schemaVersion': 1,
        'platform': args.platform,
        'commit': command('git', 'rev-parse', 'HEAD'),
        'sourceHead': os.getenv('AYIN_SOURCE_HEAD_SHA') or os.getenv('GITHUB_SHA'),
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'workflowRun': os.getenv('GITHUB_RUN_ID'),
        'workflowAttempt': os.getenv('GITHUB_RUN_ATTEMPT'),
        'environment': os.getenv('AYIN_BUILD_ENVIRONMENT', 'development'),
        'runnerImage': os.getenv('ImageOS'),
        'runnerImageVersion': os.getenv('ImageVersion'),
        'signing': args.signing,
        'toolchain': {},
        'artifacts': artifacts,
        'acceptance': 'Build provenance only; not evidence of live SDK/device acceptance.',
    }
    if args.platform == 'android':
        payload['toolchain'] = {'java': command('java', '-version'), 'gradle': command('gradle', '--version')}
    else:
        payload['toolchain'] = {'xcode': command('xcodebuild', '-version'), 'sdk': command('xcodebuild', '-showsdks'), 'xcodegen': command('xcodegen', '--version')}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + '\n')
    print(f'Wrote {args.output} with {len(artifacts)} artifact checksums')


if __name__ == '__main__':
    main()
