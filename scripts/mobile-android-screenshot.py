#!/usr/bin/env python3
"""Capture a real PNG through the emulator console, with bounded ADB recovery."""
import argparse
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
import zlib


def validate_png(path):
    """Check screenshot bytes, including chunk CRCs and complete pixel scanlines.

    Emulator screenshots are non-interlaced, 8-bit PNGs. Reject unsupported encodings
    rather than accepting a signature-only, truncated or textual ADB response.
    """
    if not 57 <= path.stat().st_size <= 64 * 1024 * 1024:
        raise ValueError('Invalid screenshot file size')
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Screenshot is not a PNG')
    offset, pixels, dimensions, ended = 8, bytearray(), None, False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError('Truncated PNG chunk')
        size = struct.unpack_from('>I', data, offset)[0]
        kind = data[offset + 4:offset + 8]
        end = offset + size + 12
        if end > len(data):
            raise ValueError('Truncated PNG payload')
        payload = data[offset + 8:end - 4]
        crc = struct.unpack_from('>I', data, end - 4)[0]
        if zlib.crc32(kind + payload) != crc:
            raise ValueError('PNG CRC mismatch')
        if dimensions is None and kind != b'IHDR':
            raise ValueError('PNG header must be first')
        if kind == b'IHDR':
            if dimensions is not None or size != 13:
                raise ValueError('Invalid PNG header')
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', payload)
            channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color)
            if not (0 < width <= 8192 and 0 < height <= 8192 and width * height <= 16777216):
                raise ValueError('Invalid screenshot dimensions')
            if depth != 8 or channels is None or (compression, filtering, interlace) != (0, 0, 0):
                raise ValueError('Unsupported screenshot PNG encoding')
            dimensions = width, height
            row_size = 1 + width * channels
        elif kind == b'IDAT':
            pixels.extend(payload)
        elif kind == b'IEND':
            if size != 0 or end != len(data):
                raise ValueError('Invalid PNG end')
            ended = True
        elif not kind[0] & 32:
            raise ValueError('Unsupported critical PNG chunk')
        offset = end
    if not ended or not pixels or dimensions is None:
        raise ValueError('Incomplete screenshot PNG')
    expected_size = row_size * height
    decoder = zlib.decompressobj()
    raw = decoder.decompress(pixels, expected_size + 1)
    if len(raw) != expected_size or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError('Incomplete or oversized PNG pixel data')
    if any(raw[position] > 4 for position in range(0, expected_size, row_size)):
        raise ValueError('Invalid PNG scanline filter')
    return dimensions


def capture(output, serial='emulator-5554'):
    output.parent.mkdir(parents=True, exist_ok=True)
    # Never allow an old or incomplete image to count as this run.
    output.unlink(missing_ok=True)
    deadline = time.monotonic() + 100

    def adb(*args, timeout=20):
        remaining = min(timeout, deadline - time.monotonic())
        if remaining <= 0:
            raise TimeoutError('Screenshot capture budget exhausted')
        return subprocess.run(['adb', '-s', serial, *args], check=True,
                              capture_output=True, text=True, timeout=remaining)

    for attempt in range(1, 4):
        try:
            if attempt > 1:
                # Reconnect only this emulator; never restart the app or its tests.
                adb('reconnect', timeout=5)
            adb('wait-for-device')
            # Official emulator console command writes to the HOST directory.
            # Do not fall back to guest screencap: that path lost the emulator
            # on this runner. Each attempt owns a new private, empty directory.
            # https://developer.android.com/studio/run/emulator-take-screenshots
            with tempfile.TemporaryDirectory(prefix='.ayin-screenshot-', dir=output.parent) as directory:
                result = adb('emu', 'screenrecord', 'screenshot', directory)
                if any(line.lstrip().startswith('KO') for line in (result.stdout + result.stderr).splitlines()):
                    raise ValueError('Emulator console rejected screenshot (KO response)')
                images = list(Path(directory).glob('*.png'))
                if len(images) != 1 or images[0].is_symlink() or not images[0].is_file():
                    raise ValueError('Emulator must create exactly one new PNG')
                width, height = validate_png(images[0])
                if adb('get-state', timeout=5).stdout.strip() != 'device':
                    raise ValueError('Emulator disconnected after screenshot capture')
                images[0].replace(output)
            print(f'Captured verified {width}x{height} emulator PNG on attempt {attempt}')
            return
        except (OSError, ValueError, zlib.error, subprocess.SubprocessError) as error:
            detail = (error.stderr or '').strip()[:240] if isinstance(error, subprocess.CalledProcessError) else str(error)
            print(f'Screenshot attempt {attempt}/3 failed: {detail}', file=sys.stderr)
        if time.monotonic() >= deadline:
            break
    raise RuntimeError('No verified emulator screenshot captured; diagnostic failed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--serial', default='emulator-5554')
    args = parser.parse_args()
    try:
        capture(args.output, args.serial)
    except (OSError, RuntimeError) as error:
        raise SystemExit(str(error))
