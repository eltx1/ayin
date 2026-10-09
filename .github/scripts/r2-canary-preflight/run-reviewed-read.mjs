// PREPARED ONLY. No connection unless the exact --execute-readonly argument is supplied.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const EXPECTED = 'ab8355f3c45e5208ef9fe6477666b8f834c231b4';
const PIN = 'SHA256:YoUNEx7Aizhzl99TReL4kGCyUY6KopzrPuPgRmhDC0Y';
const home = homedir(), dir = dirname(fileURLToPath(import.meta.url));
const fail = (code) => { process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: 'INCOMPLETE', missingBound: code })}\n`); process.exit(2); };
if (process.argv.slice(2).join(' ') !== '--execute-readonly') fail('EXECUTION_NOT_REQUESTED');
const key = join(home, '.ssh/id_ed25519'), known = join(home, '.ssh/known_hosts');
if (!existsSync(key) || !existsSync(known)) fail('EXISTING_SSH_MATERIAL_UNAVAILABLE');
// One existing, pinned ed25519 entry only. Never scan, replace, or create trust.
const lookup = spawnSync('ssh-keygen', ['-F', '13.52.116.200', '-f', known], {
  encoding: 'utf8', timeout: 3000, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'pipe'],
});
const entries = (lookup.stdout ?? '').split('\n').filter((line) => line && !line.startsWith('#'));
if (lookup.status !== 0 || entries.length !== 1 || !/^[^ ]+ ssh-ed25519 [A-Za-z0-9+/=]+(?: |$)/.test(entries[0])) fail('PINNED_HOST_ENTRY_UNAVAILABLE');
// OpenSSH SHA256 fingerprints hash the decoded public-key blob. Avoid /dev/stdin:
// Node's spawnSync input is socket-backed and cannot be reopened by ssh-keygen.
const keyBlob = Buffer.from(entries[0].trim().split(/\s+/)[2], 'base64');
const fingerprint = `SHA256:${createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`;
if (fingerprint !== PIN) fail('HOST_PIN_MISMATCH');
const command = `set -eu; test "$(whoami)" = ayin; test "$HOME" = /home/ayin; cd /home/ayin/htdocs/current; test "$(git rev-parse HEAD)" = '${EXPECTED}'; exec timeout --kill-after=2s 50s node deploy/run-with-env.cjs /home/ayin/env/api.env node --input-type=module -`;
const result = spawnSync('ssh', ['-T', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
  '-o', `IdentityFile=${key}`, '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${known}`,
  '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'UpdateHostKeys=no',
  '-o', 'ClearAllForwardings=yes', '-o', 'ConnectionAttempts=1', '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', '-o', 'LogLevel=ERROR',
  '-p', '22', 'ayin@13.52.116.200', command], {
  input: readFileSync(join(dir, 'read-preflight.mjs')), encoding: 'utf8', timeout: 65000,
  killSignal: 'SIGKILL', maxBuffer: 65536, stdio: ['pipe', 'pipe', 'pipe'],
});
// Suppress SSH errors, login banners, raw diagnostics and unrecognized output.
let proof; try { proof = JSON.parse(result.stdout); } catch { fail('SANITIZED_REMOTE_PROOF_UNAVAILABLE'); }
const strings = new Set(['INCOMPLETE', 'OBSERVED', 'r2', 'development', 'e2e', 'RUNTIME_DEFAULT',
  'PROCESS_ENV', 'STORED', 'RUNTIME_DEFAULT_INVALID_STORED', 'RUNTIME_DEFAULT_MISSING', 'alive',
  'ready', 'not_ready', 'running', 'draining', 'stopped', 'TUPLE_MISSING', 'RELEASE_UNRESOLVED',
  'LIVE_API_ENV_UNRESOLVED', 'LIVE_WORKER_ENV_UNRESOLVED', 'RUNTIME_CONTRACT_UNRESOLVED',
  'API_STORAGE_SETTINGS_UNRESOLVED', 'WORKER_STORAGE_SETTINGS_UNRESOLVED',
  'API_TIMEOUTS_UNRESOLVED', 'WORKER_TIMEOUTS_UNRESOLVED', 'LIVE_HEALTH_UNRESOLVED',
  'WORKER_HEARTBEAT_UNRESOLVED', 'DATABASE_SNAPSHOT_UNRESOLVED', 'PROCESS_CHANGED_DURING_READ',
  'READ_DEADLINE_EXCEEDED', 'RELEASE_CHANGED_DURING_READ']);
function safe(value, depth = 0) {
  if (depth > 8) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (typeof value === 'string') return strings.has(value) || /^[0-9a-f]{40}$/.test(value);
  return value && !Array.isArray(value) && typeof value === 'object' &&
    Object.entries(value).every(([key, item]) => /^[a-zA-Z][a-zA-Z0-9_]{0,80}$/.test(key) && safe(item, depth + 1));
}
if (!safe(proof) || proof.schemaVersion !== 1 || proof.expectedReleaseSha !== EXPECTED ||
  proof.readOnly !== true || proof.providerRequests !== 0 || proof.activatesCanary !== false ||
  !['OBSERVED', 'INCOMPLETE'].includes(proof.status) || (proof.status === 'OBSERVED' && result.status !== 0)) fail('SANITIZED_REMOTE_PROOF_INVALID');
process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
process.exit(proof.status === 'OBSERVED' ? 0 : 2);
