#!/usr/bin/env python3
"""Offline tempdir guards; never opens SSH or contacts a provider."""
import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
import json
import shlex
import subprocess
import sys
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('r2-continuation-once-ssh.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(os.umask, os.umask(0o022))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / 'ayin'
        self.home.mkdir(mode=0o750)
        self.ns = {'__name__': 'offline_guard_tests'}
        exec(guard.REMOTE, self.ns)
        self.ns['AYIN_HOME'] = str(self.home)
        self.sources = (b'export const fixture = 1;\n', b'import "./r2-owned-fixture-provider.mjs";\n')
        self.c = {'release': guard.RELEASE, 'tooling': 'b' * 40, 'provider': hashlib.sha256(self.sources[0]).hexdigest(), 'continuation': hashlib.sha256(self.sources[1]).hexdigest()}
        self.payload = {name: base64.b64encode(content).decode() for name, content in zip(guard.FILES[:2], self.sources)}
        self.child = self.home / '.r2-acceptance-tooling' / self.c['tooling']

    def stage(self):
        return self.ns['stage'](self.c, self.payload)

    def reject(self, operation, *args):
        with self.assertRaises((RuntimeError, OSError, ValueError)):
            operation(*args)

    def test_stages_exact_three_private_files_then_removes_only_them(self):
        journals = self.home / '.r2-acceptance-manifests'
        journals.mkdir(mode=0o700)
        journal = journals / 'original.json'
        journal.write_text('permanent original')
        receipt = self.stage()
        self.assertEqual(sorted(os.listdir(self.child)), sorted(guard.FILES))
        for name in guard.FILES:
            self.assertEqual(stat.S_IMODE((self.child / name).stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.child.stat().st_mode), 0o700)
        self.assertEqual(self.ns['verify'](self.c, receipt), receipt)
        self.ns['cleanup'](self.c, receipt)
        self.assertFalse(self.child.exists())
        self.assertTrue(self.child.parent.exists())
        self.assertEqual(journal.read_text(), 'permanent original')
        self.assertEqual(stat.S_IMODE(self.home.stat().st_mode), 0o750)

    def test_existing_child_is_never_overwritten(self):
        first = self.stage()
        self.reject(self.stage)
        self.assertEqual(self.ns['verify'](self.c, first), first)

    def test_hash_mismatch_precedes_any_staging_write(self):
        self.payload[guard.FILES[0]] = base64.b64encode(b'wrong source').decode()
        self.reject(self.stage)
        self.assertFalse(self.child.parent.exists())

    def test_unexpected_payload_and_oversized_sources_are_refused(self):
        self.payload['journal.json'] = 'e30='
        self.reject(self.stage)
        del self.payload['journal.json']
        data = b'a' * 131073
        self.payload[guard.FILES[0]] = base64.b64encode(data).decode()
        self.c['provider'] = hashlib.sha256(data).hexdigest()
        self.reject(self.stage)
        self.assertFalse(self.child.parent.exists())

    def test_unsafe_home_and_root_modes_are_not_repaired(self):
        self.home.chmod(0o770)
        self.reject(self.stage)
        self.assertEqual(stat.S_IMODE(self.home.stat().st_mode), 0o770)
        self.home.chmod(0o750)
        self.child.parent.mkdir(mode=0o755)
        self.reject(self.stage)
        self.assertEqual(stat.S_IMODE(self.child.parent.stat().st_mode), 0o755)

    def test_symlink_staging_parent_is_rejected(self):
        other = self.home / 'other'
        other.mkdir(mode=0o700)
        self.child.parent.symlink_to(other, target_is_directory=True)
        self.reject(self.stage)
        self.assertEqual(list(other.iterdir()), [])

    def test_extra_file_refuses_cleanup_before_deleting_anything(self):
        receipt = self.stage()
        (self.child / 'unexpected').write_text('keep')
        self.reject(self.ns['cleanup'], self.c, receipt)
        self.assertTrue(all((self.child / name).exists() for name in guard.FILES))

    def test_changed_content_refuses_execution_verification_and_cleanup(self):
        receipt = self.stage()
        (self.child / guard.FILES[0]).write_bytes(b'x' * len(self.sources[0]))
        self.reject(self.ns['verify'], self.c, receipt)
        self.reject(self.ns['cleanup'], self.c, receipt)
        self.assertTrue(all((self.child / name).exists() for name in guard.FILES))

    def test_changed_manifest_refuses_verification(self):
        receipt = self.stage()
        (self.child / guard.FILES[2]).write_text('{}\n')
        self.reject(self.ns['verify'], self.c, receipt)

    def test_same_bytes_with_changed_inode_refuses_cleanup(self):
        receipt = self.stage()
        name = self.child / guard.FILES[0]
        # Retain the original inode so inode reuse cannot make the test ambiguous.
        moved = self.home / 'replaced-source'
        name.rename(moved)
        name.write_bytes(self.sources[0])
        name.chmod(0o600)
        self.reject(self.ns['verify'], self.c, receipt)
        self.reject(self.ns['cleanup'], self.c, receipt)

    def test_symlink_and_fifo_file_refuse_without_reading(self):
        receipt = self.stage()
        name = self.child / guard.FILES[0]
        name.unlink()
        outside = self.home / 'outside'
        outside.write_bytes(self.sources[0])
        name.symlink_to(outside)
        self.reject(self.ns['verify'], self.c, receipt)
        name.unlink()
        os.mkfifo(name, 0o600)
        self.reject(self.ns['verify'], self.c, receipt)

    def test_hardlinks_and_wrong_file_mode_refuse(self):
        receipt = self.stage()
        name = self.child / guard.FILES[0]
        link = self.home / 'hardlink'
        os.link(name, link)
        self.reject(self.ns['verify'], self.c, receipt)
        link.unlink()
        name.chmod(0o640)
        self.reject(self.ns['verify'], self.c, receipt)

    def test_replaced_directory_identity_refuses_cleanup(self):
        receipt = self.stage()
        self.child.rename(self.home / 'old-tooling')
        self.stage()
        self.reject(self.ns['cleanup'], self.c, receipt)

    def test_invalid_sha_and_runtime_release_never_stage(self):
        self.c['tooling'] = '../elsewhere'
        self.reject(self.stage)
        self.c['tooling'] = 'b' * 40
        self.c['release'] = 'a' * 40
        self.reject(self.stage)

    def test_exec_checks_all_files_before_starting_node_and_preserves_stdin(self):
        receipt = self.stage()
        self.c['receipt'] = receipt
        events = []
        self.ns['host'] = lambda: events.append('host')
        self.ns['release'] = lambda c: str(self.home)
        original = self.ns['verify']
        self.ns['verify'] = lambda c, recorded: (events.append('verify'), original(c, recorded))[1]
        with patch.object(os, 'execvp') as execute, patch.object(os, 'chdir'), patch.object(self.ns['sys'].stdin, 'read', side_effect=AssertionError('protocol stdin consumed')):
            self.ns['remote']('exec', self.c)
            self.assertEqual(events, ['host', 'verify', 'verify'])
            self.assertEqual(execute.call_count, 1)
            command = execute.call_args.args[1]
            self.assertEqual(command[:4], ['node', 'deploy/run-with-env.cjs', str(self.home) + '/env/api.env', 'node'])
            self.assertEqual(command[4], str(self.child / guard.FILES[1]))
        (self.child / guard.FILES[0]).write_bytes(b'changed')
        with patch.object(os, 'execvp') as execute:
            self.reject(self.ns['remote'], 'exec', self.c)
            execute.assert_not_called()

    def test_wrapper_uses_only_fixed_ssh_and_exact_driver_arguments(self):
        c = self.c.copy()
        env = {'TOOLING_SHA': c['tooling'], 'PROVIDER_SHA256': c['provider'], 'CONTINUATION_SHA256': c['continuation'], 'RUNNER_TEMP': self.temp.name}
        with patch.dict(os.environ, env):
            guard.receipt_path().write_text('{}')
            exact = guard.ssh_prefix() + [guard.driver_command(c)]
            wrapper_args = ['guard', 'driver-ssh', json.dumps(c), str(guard.receipt_path())]
            for argv in [exact[:-1] + ['echo wrong'], exact + ['extra'], ['-o', 'StrictHostKeyChecking=no'] + exact]:
                with patch.object(sys, 'argv', [*wrapper_args, *argv]), patch.object(os, 'execv') as execute:
                    with self.assertRaises(AssertionError): guard.main()
                    execute.assert_not_called()
            with patch.object(sys, 'argv', [*wrapper_args, *exact]), patch.object(os, 'execv') as execute:
                guard.main()
                self.assertEqual(execute.call_args.args[0], '/usr/bin/ssh')
                self.assertEqual(execute.call_args.args[1][1:-1], exact[:-1])
                self.assertTrue(execute.call_args.args[1][-1].startswith('python3 -c '))

    def test_generated_wrapper_arguments_work_with_only_driver_environment(self):
        receipt = Path(self.temp.name) / 'r2-continuation-owned-staging.json'
        receipt.write_text('{"offline":true}')
        text = guard.wrapper_text(self.c, receipt)
        wrapper = Path(self.temp.name) / 'ssh'
        wrapper.write_text(text)
        wrapper.chmod(0o700)
        self.assertTrue(wrapper.read_bytes().startswith(b'#!/bin/sh\nexec '))
        driver_env = {'PATH': self.temp.name + ':' + os.environ['PATH'], 'HOME': str(Path.home()), 'LANG': 'C.UTF-8'}
        # Resolve and start the real generated executable through PATH, exactly
        # as the browser driver does. Invalid argv stops before opening SSH.
        refused = subprocess.run(['ssh', 'unexpected-offline-arguments'], env=driver_env, text=True, capture_output=True)
        self.assertEqual(refused.returncode, 1)
        self.assertIn('FIXED_INVOCATION_GUARD_REFUSED', refused.stderr)
        tokens = shlex.split(text.splitlines()[1])
        self.assertEqual(tokens[:2], ['exec', '/usr/bin/python3'])
        self.assertEqual(tokens[-1], '$@')
        argv = tokens[2:-1] + guard.ssh_prefix() + [guard.driver_command(self.c)]
        # Execute the actual generated helper arguments in a fresh process with
        # exactly the driver's environment. Intercept execv before any SSH opens.
        intercept = '''import json, os, runpy, shlex, sys
assert set(os.environ).issubset({'PATH', 'HOME', 'LANG', 'LC_CTYPE'})
def execute(path, argv):
    assert path == '/usr/bin/ssh' and argv[0] == path
    command = shlex.split(argv[-1])
    assert command[0:2] == ['python3', '-c'] and command[3] == 'exec'
    config = json.loads(command[4])
    print(json.dumps({'tooling': config['tooling'], 'receipt': config['receipt'], 'ssh': argv[1:-1]}))
os.execv = execute
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
'''
        result = subprocess.run([sys.executable, '-c', intercept, *argv], env=driver_env, text=True, capture_output=True, check=True)
        actual = json.loads(result.stdout)
        self.assertEqual(actual, {'tooling': self.c['tooling'], 'receipt': {'offline': True}, 'ssh': guard.ssh_prefix()})


if __name__ == '__main__':
    unittest.main(verbosity=2)
