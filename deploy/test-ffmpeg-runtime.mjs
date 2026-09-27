import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = resolve("deploy/ensure-ffmpeg-runtime.sh");
const digest = "28268bf402f1083833ea269331587f60a242848880073be8016501d864bd07a5";
for (const [name, primary, mirror, success, downloads] of [
  ["uses verified primary without contacting mirror", "valid", "invalid", true, 1],
  ["rejects primary HTML and accepts verified mirror", "invalid", "valid", true, 2],
  ["recovers from primary network failure", "network", "valid", true, 2],
  ["never extracts either invalid archive", "invalid", "invalid", false, 2],
  ["never extracts failed downloads", "network", "network", false, 2],
]) {
  test(name, () => {
    const directory = mkdtempSync(join(tmpdir(), "ayin-runtime-test-"));
    try {
      const bin = join(directory, "commands");
      mkdirSync(bin);
      const executable = (name, body) =>
        writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
      executable(
        "curl",
        `
source_url=""; output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    https:*) source_url="$1"; shift ;;
    --output) output="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$source_url" >> "$TEST_DIR/downloads"
mode="$TEST_PRIMARY"
[[ "$source_url" != *software.frc971.org* ]] || mode="$TEST_MIRROR"
[[ "$mode" != network ]] || exit 22
printf '%s' "$mode" > "$output"`,
      );
      // Model integrity results without downloading binaries in the unit suite.
      // Assert the installer still supplies the exact production pin to the verifier.
      executable(
        "sha256sum",
        `
read -r expected archive
[[ "$expected" == "${digest}" ]]
[[ "$(cat "$archive")" == valid ]]`,
      );
      executable(
        "tar",
        `
printf extracted > "$TEST_DIR/extracted"
while [[ "$1" != -C ]]; do shift; done
extract_dir="$2"
cat > "$extract_dir/ffmpeg" <<'BIN'
#!/usr/bin/env bash
case "$*" in
  *-version*) echo 'ffmpeg version 6.0.1' ;;
  *-encoders*) printf ' libx264 encoder\n aac encoder\n' ;;
  *-muxers*) echo ' hls muxer' ;;
  *) exit 1 ;;
esac
BIN
cp "$extract_dir/ffmpeg" "$extract_dir/ffprobe"`,
      );
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        AYIN_BIN_DIR: join(directory, "runtime"),
        TEST_DIR: directory,
        TEST_PRIMARY: primary,
        TEST_MIRROR: mirror,
      };
      const result = spawnSync("bash", [script], { env, encoding: "utf8" });
      assert.equal(result.status, success ? 0 : 69, result.stderr);
      assert.equal(
        readFileSync(join(directory, "downloads"), "utf8").trim().split("\n").length,
        downloads,
      );
      assert.equal(existsSync(join(directory, "extracted")), success);
      assert.equal(existsSync(join(directory, "runtime", "ffmpeg")), success);
      if (success) {
        const cached = spawnSync("bash", [script], { env, encoding: "utf8" });
        assert.equal(cached.status, 0, cached.stderr);
        assert.equal(
          readFileSync(join(directory, "downloads"), "utf8").trim().split("\n").length,
          downloads,
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
