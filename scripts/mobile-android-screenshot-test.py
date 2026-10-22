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

    def fake_adb(self, failures=None, images=None, replies=None, states=None):
        failures = list(failures or [])
        images = list(images if images is not None else [png()] * 3)
        replies = list(replies or ['OK'] * 3)
        states = list(states or ['device'] * 3)

        def run(command, **kwargs):
            self.calls.append((command, kwargs))
            self.assertGreater(kwargs['timeout'], 0)
            self.assertLessEqual(kwargs['timeout'], 20)
            self.assertTrue(kwargs['check'])
            self.assertEqual(command[:3], ['adb', '-s', 'emulator-5554'])
            if command[3:6] == ['emu', 'screenrecord', 'screenshot']:
                self.assertFalse(self.output.exists(), 'Unverified output must not be published')
                destination = Path(command[-1])
                self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
                self.assertEqual(list(destination.iterdir()), [])
                if failures:
                    raise failures.pop(0)
                image = images.pop(0)
                if image is not None:
                    (destination / 'Screenshot_20261020-120000.png').write_bytes(image)
                return subprocess.CompletedProcess(command, 0, replies.pop(0), '')
            if command[3] == 'get-state':
                return subprocess.CompletedProcess(command, 0, states.pop(0), '')
            return subprocess.CompletedProcess(command, 0, '', '')
        return run

    def assert_clean(self):
        self.assertEqual(list(self.output.parent.glob('.ayin-screenshot-*')), [])

    def test_success_uses_private_host_directory_and_postcapture_health_check(self):
        self.output.write_bytes(b'stale artifact')
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb()):
            screenshot.capture(self.output)
        self.assertEqual(self.output.read_bytes(), png())
        commands = [command for command, _ in self.calls]
        self.assertTrue(any(command[3:6] == ['emu', 'screenrecord', 'screenshot'] for command in commands))
        self.assertFalse(any(arg in command for command in commands for arg in ('exec-out', 'shell', 'pull', 'am')))
        self.assertEqual(commands[-1][3:], ['get-state'])
        self.assert_clean()

    def test_closed_transport_reconnects_once_then_captures(self):
        closed = subprocess.CalledProcessError(255, 'adb', stderr='error: closed')
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(failures=[closed])):
            screenshot.capture(self.output)
        self.assertEqual(sum(command[3] == 'reconnect' for command, _ in self.calls), 1)
        self.assertEqual(screenshot.validate_png(self.output), (1, 1))
        self.assert_clean()

    def test_truncated_image_is_rejected_then_recaptured_in_new_directory(self):
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(images=[png()[:-5], png()])):
            screenshot.capture(self.output)
        directories = [command[-1] for command, _ in self.calls if command[3] == 'emu']
        self.assertEqual(len(set(directories)), 2)
        self.assertEqual(self.output.read_bytes(), png())
        self.assert_clean()

    def test_persistent_failure_is_finite_and_leaves_no_stale_output(self):
        self.output.write_bytes(png())
        closed = subprocess.CalledProcessError(255, 'adb', stderr='error: closed')
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(failures=[closed] * 3)), self.assertRaisesRegex(RuntimeError, 'No verified'):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(sum(command[3] == 'emu' for command, _ in self.calls), 3)
        self.assert_clean()

    def test_timeouts_are_bounded_and_remove_private_capture_directories(self):
        timeout = subprocess.TimeoutExpired('adb', 20)
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(failures=[timeout] * 3)), self.assertRaises(RuntimeError):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        self.assert_clean()

    def test_zero_exit_ko_response_cannot_publish_even_a_valid_png(self):
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(replies=['KO: capture failed'] * 3)), self.assertRaises(RuntimeError):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        self.assert_clean()

    def test_valid_png_cannot_hide_disconnected_emulator(self):
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(states=['offline'] * 3)), self.assertRaises(RuntimeError):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        self.assert_clean()

    def test_success_reply_without_new_png_fails(self):
        with patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb(images=[None] * 3)), self.assertRaises(RuntimeError):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        self.assert_clean()

    def test_expired_total_budget_stops_without_another_capture(self):
        with patch.object(screenshot.time, 'monotonic', side_effect=[0, 101, 101]), patch.object(screenshot.subprocess, 'run', side_effect=self.fake_adb()), self.assertRaises(RuntimeError):
            screenshot.capture(self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.calls, [])
        self.assert_clean()

    def test_rejects_invalid_or_incomplete_pixel_payloads(self):
        corrupt = bytearray(png()); corrupt[29] ^= 1
        for invalid in [b'error: closed', png()[:33], bytes(corrupt), png()[:-12], png(raw=b''), png(raw=b'\x05\0\0\0\0'), png(raw=b'\0' * 1000), png() + b'extra']:
            with self.subTest(payload=invalid[:8]):
                self.output.write_bytes(invalid)
                with self.assertRaises((ValueError, zlib.error)):
                    screenshot.validate_png(self.output)


if __name__ == '__main__':
    unittest.main()
