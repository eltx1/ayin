#!/usr/bin/env bash
set -euo pipefail
umask 027

# Keep the verified runtime outside release directories so successful media jobs never depend on an old release.
AYIN_BIN_DIR="${AYIN_BIN_DIR:-/home/ayin/bin}"
FFMPEG_VERSION="6.0.1"
FFMPEG_URL="https://www.johnvansickle.com/ffmpeg/old-releases/ffmpeg-6.0.1-amd64-static.tar.xz"
FFMPEG_FALLBACK_URL="https://software.frc971.org/Build-Dependencies/www.johnvansickle.com/ffmpeg/old-releases/ffmpeg-6.0.1-amd64-static.tar.xz"
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
  "$AYIN_BIN_DIR/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -E "[[:space:]]aac[[:space:]]" >/dev/null || return 1
  "$AYIN_BIN_DIR/ffmpeg" -hide_banner -muxers 2>/dev/null | grep -E "[[:space:]]hls[[:space:]]" >/dev/null || return 1
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

download_verified_archive() {
  local url
  for url in "$FFMPEG_URL" "$FFMPEG_FALLBACK_URL"; do
    rm -f "$archive"
    if curl --fail --location --silent --show-error --retry 3 --retry-all-errors \
      "$url" --output "$archive" &&
      printf '%s  %s\n' "$FFMPEG_SHA256" "$archive" | sha256sum --check --status; then
      echo "Verified pinned FFmpeg archive from $url"
      return 0
    fi
    echo "warning: pinned FFmpeg archive unavailable or checksum-invalid at $url" >&2
  done
  echo "error: unable to obtain checksum-verified FFmpeg $FFMPEG_VERSION runtime" >&2
  return 69
}

download_verified_archive

tar -xJf "$archive" -C "$extract_dir" --strip-components=1
install -m 755 "$extract_dir/ffmpeg" "$AYIN_BIN_DIR/ffmpeg"
install -m 755 "$extract_dir/ffprobe" "$AYIN_BIN_DIR/ffprobe"

runtime_ok || {
  echo "error: installed FFmpeg runtime failed validation" >&2
  exit 69
}

echo "Installed and verified pinned FFmpeg $FFMPEG_VERSION runtime."
