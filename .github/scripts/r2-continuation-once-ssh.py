#!/usr/bin/env python3
"""Fixed one-time source staging and SSH bootstrap; no provider calls or retries."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

RELEASE = "a6c15842bd2cf6990715f18d58a550a5929d8d41"
RUN = "34c4947c-ba13-4fc9-9087-0d1db8cc4d28"
FILES = ("r2-owned-fixture-provider.mjs", "r2-owned-continuation-provider.mjs", "tooling-manifest.json")

# This code is sent in the trusted SSH command, never loaded from staged files.
# All paths are fixed here. Tests replace AYIN_HOME only in an isolated namespace.
REMOTE = r'''
import base64, hashlib, json, os, pwd, re, stat, subprocess, sys
AYIN_HOME = '/home/ayin'
NAMES = ('r2-owned-fixture-provider.mjs', 'r2-owned-continuation-provider.mjs', 'tooling-manifest.json')
LIMIT = 131072
def require(ok):
    if not ok: raise RuntimeError('STAGING_GUARD_REFUSED')
def identity(s):
    return [s.st_dev, s.st_ino, s.st_uid, stat.S_IMODE(s.st_mode)]
def file_identity(s):
    return identity(s) + [s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns]
def directory(path, mode):
    before = os.lstat(path)
    require(stat.S_ISDIR(before.st_mode) and before.st_uid == os.getuid())
    require(stat.S_IMODE(before.st_mode) == mode and os.path.realpath(path) == path)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
    require(identity(os.fstat(fd)) == identity(before))
    return fd
def layout(c):
    require(re.fullmatch('[0-9a-f]{40}', c['tooling']) is not None)
    require(c['release'] == 'a6c15842bd2cf6990715f18d58a550a5929d8d41')
    require(all(re.fullmatch('[0-9a-f]{64}', c[k]) for k in ('provider', 'continuation')))
    root = AYIN_HOME + '/.r2-acceptance-tooling'
    return root, root + '/' + c['tooling']
def manifest(c):
    return (json.dumps({'toolingSha': c['tooling'], 'providerSha256': c['provider'], 'continuationSha256': c['continuation']}, separators=(',', ':')) + '\n').encode()
def hashes(c):
    return (c['provider'], c['continuation'], hashlib.sha256(manifest(c)).hexdigest())
def host():
    require(pwd.getpwuid(os.getuid()).pw_name == 'ayin' and os.environ.get('HOME') == AYIN_HOME)
    require(not os.access('/home/horusapp', os.W_OK))
    fd = directory(AYIN_HOME, 0o750)
    os.close(fd)
def release(c):
    current = AYIN_HOME + '/htdocs/current'
    resolved = os.path.realpath(current)
    require(resolved.startswith(AYIN_HOME + '/htdocs/releases/'))
    def git(*args):
        return subprocess.check_output(['/usr/bin/git', *args], cwd=current, stderr=subprocess.DEVNULL, timeout=15).decode().strip()
    require(git('rev-parse', 'HEAD') == c['release'])
    require(git('rev-parse', '--show-toplevel') == resolved)
    require(git('status', '--porcelain', '--untracked-files=no') == '')
    for url in ('http://127.0.0.1:3000/', 'http://127.0.0.1:4000/health', 'http://127.0.0.1:4000/ready'):
        subprocess.run(['/usr/bin/curl', '--fail', '--silent', '--max-time', '15', url], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=18)
    return current
def verify(c, recorded=None):
    root, child = layout(c)
    fds = []
    try:
        for path, mode in ((AYIN_HOME, 0o750), (root, 0o700), (child, 0o700)):
            fds.append(directory(path, mode))
        result = {'directories': [identity(os.fstat(fd)) for fd in fds], 'files': {}}
        require(sorted(os.listdir(fds[-1])) == sorted(NAMES))
        for name, expected in zip(NAMES, hashes(c)):
            before = os.stat(name, dir_fd=fds[-1], follow_symlinks=False)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid())
            require(stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1 and 0 < before.st_size <= LIMIT)
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fds[-1])
            try:
                require(file_identity(os.fstat(fd)) == file_identity(before))
                data = b''
                while len(data) <= LIMIT:
                    piece = os.read(fd, min(16384, LIMIT + 1 - len(data)))
                    if not piece: break
                    data += piece
                require(len(data) == before.st_size and hashlib.sha256(data).hexdigest() == expected)
                require(file_identity(os.fstat(fd)) == file_identity(before))
                require(file_identity(os.stat(name, dir_fd=fds[-1], follow_symlinks=False)) == file_identity(before))
                result['files'][name] = file_identity(before)
            finally:
                os.close(fd)
        require(recorded is None or result == recorded)
        require([identity(os.lstat(p)) for p in (AYIN_HOME, root, child)] == result['directories'])
        return result
    finally:
        for fd in fds: os.close(fd)
def stage(c, payload):
    root, child = layout(c)
    require(set(payload) == set(NAMES[:2]))
    data = [base64.b64decode(payload[name], validate=True) for name in NAMES[:2]] + [manifest(c)]
    require(all(0 < len(b) <= LIMIT and hashlib.sha256(b).hexdigest() == h for b, h in zip(data, hashes(c))))
    homefd = directory(AYIN_HOME, 0o750)
    try:
        try: os.mkdir('.r2-acceptance-tooling', 0o700, dir_fd=homefd)
        except FileExistsError: pass
        os.fsync(homefd)
        rootfd = directory(root, 0o700)
        try:
            os.mkdir(c['tooling'], 0o700, dir_fd=rootfd)  # Always exclusive; never reset.
            os.fsync(rootfd)
            childfd = directory(child, 0o700)
            try:
                for name, content in zip(NAMES, data):
                    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=childfd)
                    try:
                        with os.fdopen(fd, 'wb', closefd=False) as stream:
                            stream.write(content)
                            stream.flush()
                            os.fsync(fd)
                    finally: os.close(fd)
                os.fsync(childfd)
            finally: os.close(childfd)
        finally: os.close(rootfd)
    finally: os.close(homefd)
    return verify(c)
def cleanup(c, recorded):
    # Complete validation precedes every deletion; any extra/changed file refuses all.
    verify(c, recorded)
    root, child = layout(c)
    rootfd, childfd = directory(root, 0o700), directory(child, 0o700)
    try:
        require(identity(os.fstat(rootfd)) == recorded['directories'][1])
        require(identity(os.fstat(childfd)) == recorded['directories'][2])
        require(sorted(os.listdir(childfd)) == sorted(NAMES))
        for name in NAMES:
            require(file_identity(os.stat(name, dir_fd=childfd, follow_symlinks=False)) == recorded['files'][name])
        for name in NAMES:
            require(file_identity(os.stat(name, dir_fd=childfd, follow_symlinks=False)) == recorded['files'][name])
            os.unlink(name, dir_fd=childfd)
        os.fsync(childfd)
        require(identity(os.stat(c['tooling'], dir_fd=rootfd, follow_symlinks=False)) == recorded['directories'][2])
        os.rmdir(c['tooling'], dir_fd=rootfd)
        os.fsync(rootfd)
    finally:
        os.close(childfd)
        os.close(rootfd)
def remote(operation, c):
    os.umask(0o077)
    host()
    layout(c)
    if operation == 'stage':
        release(c)
        raw = sys.stdin.buffer.read(400001)
        require(len(raw) <= 400000)
        print(json.dumps(stage(c, json.loads(raw))))
    elif operation == 'exec':
        verify(c, c['receipt'])  # No staged import, Node process or protocol read before this.
        current = release(c)
        verify(c, c['receipt'])
        os.chdir(current)
        args = ['node', 'deploy/run-with-env.cjs', AYIN_HOME + '/env/api.env', 'node', layout(c)[1] + '/r2-owned-continuation-provider.mjs', '--execute-approved', '--execute-continuation-approved', '--run-id', '34c4947c-ba13-4fc9-9087-0d1db8cc4d28', '--confirm-prefix', 'ayin-recovery-acceptance/34c4947c-ba13-4fc9-9087-0d1db8cc4d28/', '--ack-cleanup', 'DELETE_ONLY_CREATED_FIXTURES', '--release-sha', c['release'], '--tooling-sha', c['tooling']]
        os.execvp(args[0], args)
    elif operation == 'cleanup':
        cleanup(c, c['receipt'])
    else: require(False)
if __name__ == '__main__':
    try: remote(sys.argv[1], json.loads(sys.argv[2]))
    except Exception:
        print('FIXED_SOURCE_BOOTSTRAP_REFUSED', file=sys.stderr)
        sys.exit(1)
'''

def config():
    c = {'release': RELEASE, 'tooling': os.environ['TOOLING_SHA'], 'provider': os.environ['PROVIDER_SHA256'], 'continuation': os.environ['CONTINUATION_SHA256']}
    return check_config(c)

def check_config(c):
    assert set(c) == {'release', 'tooling', 'provider', 'continuation'} and c['release'] == RELEASE
    assert re.fullmatch('[0-9a-f]{40}', c['tooling'])
    assert all(re.fullmatch('[0-9a-f]{64}', c[k]) for k in ('provider', 'continuation'))
    return c

def ssh_prefix():
    home = str(Path.home())
    return ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', f'IdentityFile={home}/.ssh/id_ed25519', '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={home}/.ssh/known_hosts', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', '22', 'ayin@13.52.116.200']

def driver_command(c):
    flags = f"--execute-approved --execute-continuation-approved --run-id {RUN} --confirm-prefix ayin-recovery-acceptance/{RUN}/ --ack-cleanup DELETE_ONLY_CREATED_FIXTURES --release-sha {RELEASE} --tooling-sha {c['tooling']}"
    return f'''set -eu; test "$(whoami)" = ayin; test "$HOME" = /home/ayin; test -w /home/ayin/htdocs/releases; test -w /home/ayin/env; test ! -w /home/horusapp; cd /home/ayin/htdocs/current; test "$(git rev-parse HEAD)" = '{RELEASE}'; exec node deploy/run-with-env.cjs /home/ayin/env/api.env node /home/ayin/.r2-acceptance-tooling/{c['tooling']}/r2-owned-continuation-provider.mjs {flags}'''

def remote_command(operation, c):
    return 'python3 -c ' + shlex.quote(REMOTE) + ' ' + shlex.quote(operation) + ' ' + shlex.quote(json.dumps(c, separators=(',', ':')))

def receipt_path():
    return Path(os.environ['RUNNER_TEMP']) / 'r2-continuation-owned-staging.json'

def wrapper_text(c, receipt):
    # The driver intentionally supplies only PATH/HOME/LANG. Fixed nonsecret
    # configuration and receipt location travel as quoted arguments instead.
    args = ['/usr/bin/python3', str(Path(__file__).resolve()), 'driver-ssh', json.dumps(c, separators=(',', ':')), str(receipt)]
    return '#!/bin/sh\nexec ' + ' '.join(shlex.quote(arg) for arg in args) + ' "$@"\n'

def main():
    operation = sys.argv[1]
    if operation == 'driver-ssh':
        c = check_config(json.loads(sys.argv[2]))
        receipt = Path(sys.argv[3])
        assert receipt.is_absolute() and receipt.name == 'r2-continuation-owned-staging.json'
        assert sys.argv[4:] == ssh_prefix() + [driver_command(c)], 'UNEXPECTED_DRIVER_SSH_ARGUMENTS'
        c['receipt'] = json.loads(receipt.read_text())
        os.execv('/usr/bin/ssh', ['/usr/bin/ssh', *ssh_prefix(), remote_command('exec', c)])
        return
    c = config()
    if operation == 'stage':
        assert not receipt_path().exists()
        source = Path.cwd() / 'deploy/media'
        payload = {name: base64.b64encode((source / name).read_bytes()).decode() for name in FILES[:2]}
        result = subprocess.run(['/usr/bin/ssh', *ssh_prefix(), remote_command('stage', c)], input=json.dumps(payload).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=100, check=True)
        assert len(result.stdout) <= 8192
        receipt = json.loads(result.stdout)
        fd = os.open(receipt_path(), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream: json.dump(receipt, stream)
        wrapper_dir = Path(os.environ['RUNNER_TEMP']) / 'r2-continuation-ssh'
        wrapper_dir.mkdir(mode=0o700)
        wrapper = wrapper_dir / 'ssh'
        wrapper.write_text(wrapper_text(c, receipt_path()))
        wrapper.chmod(0o700)
    elif operation == 'cleanup':
        c['receipt'] = json.loads(receipt_path().read_text())
        subprocess.run(['/usr/bin/ssh', *ssh_prefix(), remote_command('cleanup', c)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
    else: raise RuntimeError('INVALID_LOCAL_OPERATION')

if __name__ == '__main__':
    try: main()
    except Exception:
        print('FIXED_INVOCATION_GUARD_REFUSED; retained sources and journals require review.', file=sys.stderr)
        sys.exit(1)
