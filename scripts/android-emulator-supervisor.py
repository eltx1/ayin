#!/usr/bin/env python3
"""Record emulator process exit evidence without changing its output or environment."""
import argparse
import datetime
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def supervise(report, command):
    report = Path(report)
    if not command:
        raise ValueError('An emulator command is required')
    # The caller must provide an existing owned directory and a fresh report name.
    # Exclusive reservation rejects stale evidence and symlinks rather than overwriting.
    with report.open('x', encoding='utf-8') as reserved:
        reserved.write('{}\n')
        identity = os.fstat(reserved.fileno())
    state = {'schemaVersion': 1, 'startedAt': utc_now(), 'endedAt': None,
             'pid': None, 'exitCode': None, 'signal': None, 'status': 'starting'}

    def write():
        nonlocal identity
        current = report.lstat()
        if (current.st_dev, current.st_ino) != (identity.st_dev, identity.st_ino):
            raise RuntimeError('Supervisor report was replaced externally')
        fd, temporary = tempfile.mkstemp(prefix='.emulator-report-', dir=report.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                json.dump(state, output, sort_keys=True)
                output.write('\n')
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, report)
            identity = report.lstat()
        finally:
            Path(temporary).unlink(missing_ok=True)

    write()
    try:
        # Inherit stdout/stderr so the existing emulator log remains authoritative.
        # Do not serialize arguments or environment: either could contain credentials.
        child = subprocess.Popen(command)
    except OSError as error:
        state.update(status='launch_failed', endedAt=utc_now(), launchErrno=error.errno)
        write()
        return 127
    state.update(status='running', pid=child.pid)
    write()
    handlers = {}

    def forward(signum, _frame):
        if child.poll() is None:
            try:
                child.send_signal(signum)
            except ProcessLookupError:
                pass

    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            handlers[signum] = signal.signal(signum, forward)
        code = child.wait()
    finally:
        for signum, handler in handlers.items():
            signal.signal(signum, handler)
    state.update(status='exited', endedAt=utc_now(), exitCode=code,
                 signal=-code if code < 0 else None)
    write()
    return 128 - code if code < 0 else code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('Provide -- followed by the emulator command')
    try:
        return supervise(args.report, command)
    except (OSError, ValueError, RuntimeError) as error:
        # No process arguments or environment values are logged.
        parser.exit(1, f'Emulator supervisor report failure: {type(error).__name__}\n')


if __name__ == '__main__':
    raise SystemExit(main())
