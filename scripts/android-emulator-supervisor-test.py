#!/usr/bin/env python3
"""Real subprocess tests for emulator lifetime diagnostics; no Android SDK required."""
import importlib.util
import json
from pathlib import Path
import signal
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('supervisor', Path(__file__).with_name('android-emulator-supervisor.py'))
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


class SupervisorTest(unittest.TestCase):
    def run_child(self, source):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'status.json'
            code = supervisor.supervise(report, [sys.executable, '-c', source])
            data = json.loads(report.read_text())
            self.assertEqual('exited', data['status'])
            self.assertGreater(data['pid'], 0)
            self.assertLessEqual(data['startedAt'], data['endedAt'])
            self.assertNotIn('command', data)
            self.assertNotIn('environment', data)
            self.assertEqual([], list(Path(directory).glob('.emulator-report-*')))
            return code, data

    def test_normal_completion(self):
        code, data = self.run_child('pass')
        self.assertEqual(0, code)
        self.assertEqual(0, data['exitCode'])
        self.assertIsNone(data['signal'])

    def test_child_failure_is_not_a_signal(self):
        code, data = self.run_child('raise SystemExit(7)')
        self.assertEqual(7, code)
        self.assertEqual(7, data['exitCode'])
        self.assertIsNone(data['signal'])

    def test_signal_is_preserved_separately(self):
        code, data = self.run_child('import os, signal; os.kill(os.getpid(), signal.SIGKILL)')
        self.assertEqual(137, code)
        self.assertEqual(-signal.SIGKILL, data['exitCode'])
        self.assertEqual(signal.SIGKILL, data['signal'])

    def test_refuses_existing_report_and_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'existing'
            target.write_text('preserve')
            link = Path(directory) / 'link'
            link.symlink_to(target)
            for path in (target, link):
                with self.assertRaises(FileExistsError):
                    supervisor.supervise(path, [sys.executable, '-c', 'raise Exception("must not run")'])
            self.assertEqual('preserve', target.read_text())

    def test_launch_failure_is_recorded_without_command(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'status.json'
            code = supervisor.supervise(report, [str(Path(directory) / 'missing')])
            data = json.loads(report.read_text())
            self.assertEqual(127, code)
            self.assertEqual('launch_failed', data['status'])
            self.assertEqual(2, data['launchErrno'])
            self.assertIsNone(data['pid'])
            self.assertIsNotNone(data['endedAt'])


if __name__ == '__main__':
    unittest.main()
