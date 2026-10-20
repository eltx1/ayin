#!/usr/bin/env python3
"""Transport/integrity tests only; these do not replace emulator screenshot proof."""
import importlib.util
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zlib


spec = importlib.util.spec_from_file_location('screenshot', Path(__file__).with_name('mobile-android-screenshot.py'))
screenshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screenshot)


def png(raw=b'\0\x10\x20\x30\xff', width=1, height=1):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class ScreenshotTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name) / 'startup.png'
        self.calls = []

    def fake_adb(self, failures=None, transferred=None, cleanup_failure=False):
        failures = list(failures or [])
        transferred = list(transferred or [png()])

        def run(command, **kwargs):
            self.calls.append((command, kwargs))
            self.assertGreater(kwargs['timeout'], 0)
            self.assertLessEqual(kwargs['timeout'], 20)
            self.assertTrue(kwargs['check'])
            self.assertEqual(command[:3], ['adb', '-s', 'emulator-5554'])
            if command[3:5] == ['shell', 'screencap'] and failures:
                raise failures.pop(0)
            if command[3] == 'pull':
                self.assertFalse(self.output.exists(), 'Unverified output must not be published')
                Path(command[-1]).write_bytes(transferred.pop(0))
            if command[3:5] == ['shell', 'rm'] and cleanup_failure:
                raise subprocess.TimeoutExpired(command, kwargs['timeout'])
            return subprocess.CompletedProcess(command, 0, '', '')
        return run

    def test_success_uses_device_file_and_atomic_verified_output(self):
        self.output.write_bytes(b'stale artifact')
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb()):
            screenshot.capture(self.output)
        self.assertEqual(self.output.read_bytes(), png())
        commands = [command for command, _ in self.calls]
        self.assertTrue(any(command[3:6] == ['shell', 'screencap', '-p'] for command in commands))
        self.assertFalse(any('exec-out' in command or 'am' in command for command in commands))
        self.assertEqual(list(self.output.parent.glob('*.part')), [])
        self.assertEqual(commands[-1][3:6], ['shell', 'rm', '-f'])

    def test_closed_transport_reconnects_once_then_captures(self):
        closed = subprocess.CalledProcessError(255, 'adb', stderr='error: closed')
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(failures=[closed])):
            screenshot.capture(self.output)
        self.assertEqual(sum(command[3] == 'reconnect' for command, _ in self.calls), 1)
        self.assertEqual(screenshot.validate_png(self.output), (1, 1))

    def test_truncated_pull_is_rejected_then_recaptured(self):
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(transferred=[png()[:-5], png()])):
            screenshot.capture(self.output)
        self.assertEqual(sum(command[3] == 'pull' for command, _ in self.calls), 2)
        self.assertEqual(self.output.read_bytes(), png())

    def test_persistent_failure_is_finite_and_leaves_no_stale_output(self):
        self.output.write_bytes(png())
        closed = subprocess.CalledProcessError(255, 'adb', stderr='error: closed')
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(failures=[closed] * 3)), self.assertRaisesRegex(RuntimeError, 'No verified'):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(sum(command[3:5] == ['shell', 'screencap'] for command, _ in self.calls), 3)
        self.assertEqual(sum(command[3:5] == ['shell', 'rm'] for command, _ in self.calls), 3)

    def test_timeouts_and_failed_cleanup_do_not_create_success(self):
        timeout = subprocess.TimeoutExpired('adb', 20)
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(failures=[timeout] * 3, cleanup_failure=True)), self.assertRaises(RuntimeError):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        cleanup = [options['timeout'] for command, options in self.calls if command[3:5] == ['shell', 'rm']]
        self.assertEqual(cleanup, [3, 3, 3])

    def test_expired_total_budget_stops_without_another_capture(self):
        with patch.object(screenshot.time, 'monotonic', side_effect=[0, 101, 101]), patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb()), self.assertRaises(RuntimeError):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][0][3:6], ['shell', 'rm', '-f'])

    def test_rejects_invalid_or_incomplete_pixel_payloads(self):
        corrupt = bytearray(png()); corrupt[29] ^= 1
        for invalid in [b'error: closed', png()[:33], bytes(corrupt), png()[:-12], png(raw=b''), png(raw=b'\x05\0\0\0\0'), png(raw=b'\0' * 1000), png() + b'extra']:
            with self.subTest(payload=invalid[:8]):
                self.output.write_bytes(invalid)
                with self.assertRaises((ValueError, zlib.error)):
                    screenshot.validate_png(self.output)


if __name__ == '__main__':
    unittest.main()
