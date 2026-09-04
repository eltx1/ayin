#!/usr/bin/env bash
set -euo pipefail
umask 027

AYIN_BIN_DIR="${AYIN_BIN_DIR:-/home/ayin/bin}"
FFMPEG_VERSION="6.0.1"
FFMPEG_URL="https://www.johnvansickle.com/ffmpeg/old-releases/ffmpeg-6.0.1-amd64-static.tar.xz"
FFMPEG_SHA256="28268bf402f1083833ea269331587f60a242848880073be8016501d864bd07a5"

for required in curl tar xz sha256sum install mktemp grep; do
  command -v "$required" >/dev/null 2>&1 || {
    echo "error: required media-runtime command '$required' is missing" >&2
    exit 69
  }
done

mkdir -p "$AYIN_BIN_DIR"

runtime_ok() {
  [[ -x "$AYIN_BIN_DIR/ffmpeg" && -x "$AYIN_BIN_DIR/ffprobe" ]] || return 1
  "$AYIN_BIN_DIR/ffmpeg" -hide_banner -version 2>/dev/null | grep -F "ffmpeg version $FFMPEG_VERSION" >/dev/null || return 1
  "$AYIN_BIN_DIR/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -F "libx264" >/dev/null || return 1
  "$AYIN_BIN_DIR/ffprobe" -hide_banner -version >/dev/null 2>&1 || return 1
}

if runtime_ok; then
  echo "Pinned FFmpeg $FFMPEG_VERSION runtime verified."
  exit 0
fi

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
archive="$temp_dir/ffmpeg.tar.xz"
extract_dir="$temp_dir/extracted"
mkdir -p "$extract_dir"

curl --fail --location --silent --show-error --retry 3 --retry-all-errors \
  "$FFMPEG_URL" --output "$archive"
printf '%s  %s\n' "$FFMPEG_SHA256" "$archive" | sha256sum --check --status

tar -xJf "$archive" -C "$extract_dir" --strip-components=1
install -m 755 "$extract_dir/ffmpeg" "$AYIN_BIN_DIR/ffmpeg"
install -m 755 "$extract_dir/ffprobe" "$AYIN_BIN_DIR/ffprobe"

runtime_ok || {
  echo "error: installed FFmpeg runtime failed validation" >&2
  exit 69
}

echo "Installed and verified pinned FFmpeg $FFMPEG_VERSION runtime."
