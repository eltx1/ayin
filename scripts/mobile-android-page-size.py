#!/usr/bin/env python3
"""Reject 64-bit native ELF libraries incompatible with 16 KB Android pages.

Checks PT_LOAD alignment in the release AAB. APK ZIP alignment is checked
separately by Android build-tools zipalign; this does not emulate a 16 KB device.
"""
import argparse
from pathlib import Path
import struct
import zipfile


def alignment_errors(data):
    if len(data) < 64 or data[:4] != b'\x7fELF' or data[4] != 2:
        return ['expected a 64-bit ELF header']
    if data[5] not in (1, 2):
        return ['invalid ELF byte order']
    endian = '<' if data[5] == 1 else '>'
    offset = struct.unpack_from(endian + 'Q', data, 32)[0]
    size, count = struct.unpack_from(endian + 'HH', data, 54)
    if size < 56 or offset + count * size > len(data):
        return ['truncated ELF program headers']
    errors = []
    load_segments = 0
    for index in range(count):
        header = offset + index * size
        kind = struct.unpack_from(endian + 'I', data, header)[0]
        if kind != 1:
            continue
        load_segments += 1
        file_offset, address = struct.unpack_from(endian + 'QQ', data, header + 8)
        alignment = struct.unpack_from(endian + 'Q', data, header + 48)[0]
        if alignment < 16384 or (address - file_offset) % 16384 != 0:
            errors.append(f'PT_LOAD {index} is not aligned for 16 KB pages')
    if not load_segments:
        errors.append("ELF has no loadable segment")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('bundle', type=Path)
    args = parser.parse_args()
    checked = 0
    failures = []
    with zipfile.ZipFile(args.bundle) as archive:
        for entry in archive.infolist():
            if '/lib/' not in entry.filename or not entry.filename.endswith('.so'):
                continue
            if not any('/' + abi + '/' in entry.filename for abi in ['arm64-v8a', 'x86_64']):
                continue
            checked += 1
            failures.extend(f'{entry.filename}: {issue}' for issue in alignment_errors(archive.read(entry)))
    if failures:
        raise SystemExit('\n'.join(failures))
    print(f'64-bit ELF alignment PASS: checked {checked} native libraries (not a physical-device test).')


if __name__ == '__main__':
    main()
