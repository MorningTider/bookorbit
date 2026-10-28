#!/usr/bin/env python3
"""Ordinary-account lifecycle for an isolated native BookOrbit candidate."""
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ALLOWED = set('DATABASE_URL JWT_SECRET JWT_EXPIRES_IN JWT_REFRESH_EXPIRES_IN SETUP_BOOTSTRAP_TOKEN PODCAST_ENCRYPTION_KEY BOOK_REQUEST_ENCRYPTION_KEY EMAIL_ENCRYPTION_KEY MIGRATION_ENCRYPTION_KEY DISABLE_LOCAL_AUTH APP_URL CLIENT_URL TZ LOG_LEVEL BOOK_DOCK_PATH LIBRARY_BROWSE_ROOT COVER_SLOTS_BACKFILL_MODE'.split())


def configuration(state):
    path = state / 'service.json'
    info = path.stat()
    if info.st_uid != os.geteuid() or info.st_mode & 0o077 or path.is_symlink():
        raise ValueError('Service configuration must be an owned private regular file')
    value = json.loads(path.read_text())
    if value.get('schemaVersion') != 1 or value.get('mode') != 'isolated':
        raise ValueError('Only isolated acceptance is enabled in this candidate')
    port = value.get('port')
    if isinstance(port, bool) or not isinstance(port, int) or not 1024 < port < 65536:
        raise ValueError('An unprivileged TCP port is required')
    environment = value.get('environment', {})
    if not isinstance(environment, dict) or not {'DATABASE_URL', 'JWT_SECRET', 'SETUP_BOOTSTRAP_TOKEN'} <= environment.keys():
        raise ValueError('Database and authentication configuration required')
    for key, item in environment.items():
        if key not in ALLOWED or not isinstance(item, str) or '\x00' in item:
            raise ValueError('Unsupported service environment entry')
    url = urllib.parse.urlsplit(environment['DATABASE_URL'])
    if url.scheme not in ('postgres', 'postgresql') or not re.fullmatch(r'/bookorbit_spk_pathcheck_[a-z0-9_]+', url.path):
        raise ValueError('An isolated database identity is required')
    if url.hostname != '127.0.0.1':
        raise ValueError('Isolation database must use loopback')
    if len(environment['SETUP_BOOTSTRAP_TOKEN']) < 32:
        raise ValueError('Use a strong isolated setup bootstrap token')
    if len(environment['JWT_SECRET']) < 32:
        raise ValueError('Use a strong isolated signing key')
    return value


def atomic(path, value):
    temporary = path.with_name('.' + path.name + '-' + str(os.getpid()))
    fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream);stream.flush();os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary.exists():temporary.unlink()


def ticks(pid):
    # The command name may contain spaces and parentheses.
    return pathlib.Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19]


def alive(state):
    try:
        value = json.loads((state / 'service.pid.json').read_text())
        pid = value['pid']
        if not isinstance(pid, int) or pid < 2:return False
        proc = pathlib.Path('/proc') / str(pid)
        args = (proc / 'cmdline').read_bytes().split(b'\0')
        return (proc.stat().st_uid == os.geteuid() and ticks(pid) == value['startTicks']
                and str(pathlib.Path(__file__).resolve()).encode() in args and b'supervise' in args
                and str(state).encode() in args)
    except (OSError, ValueError, KeyError, TypeError):return False


def child_identity(root, state):
    try:
        value=json.loads((state/'child.pid.json').read_text());pid=value['pid']
        if not isinstance(pid,int) or pid<2:return None
        proc=pathlib.Path('/proc')/str(pid)
        if proc.stat().st_uid!=os.geteuid() or ticks(pid)!=value['startTicks']:return None
        if (proc/'exe').resolve(strict=True)!=(root/'bin/node').resolve(strict=True):return None
        if (proc/'cwd').resolve(strict=True)!=(root/'app').resolve(strict=True):return None
        if b'dist/main.js' not in (proc/'cmdline').read_bytes().split(b'\0') or os.getpgid(pid)!=pid:return None
        return pid
    except (OSError,ValueError,KeyError,TypeError):return None


def stop_orphan(root, state):
    pid=child_identity(root,state)
    if pid is not None:
        try:os.killpg(pid,signal.SIGTERM)
        except ProcessLookupError:pass
        deadline=time.monotonic()+15
        while child_identity(root,state)==pid and time.monotonic()<deadline:time.sleep(0.1)
        if child_identity(root,state)==pid:
            os.killpg(pid,signal.SIGKILL)
            deadline=time.monotonic()+5
            while child_identity(root,state)==pid and time.monotonic()<deadline:time.sleep(0.1)
        if child_identity(root,state)==pid:raise RuntimeError('An owned orphan child did not stop')
    (state/'child.pid.json').unlink(missing_ok=True)


def environment(root, state, config):
    home = state / 'home';home.mkdir(exist_ok=True, mode=0o700)
    data = state / 'data';data.mkdir(exist_ok=True, mode=0o700)
    temporary = state / 'tmp';temporary.mkdir(exist_ok=True, mode=0o700)
    metadata=root/'acceptance-build.json'
    cache_key=hashlib.sha256(metadata.read_bytes()).hexdigest() if metadata.is_file() else 'unpackaged'
    env = {**config['environment'], 'PATH': str(root / 'bin') + ':/usr/bin:/bin', 'HOME': str(home),
           'TMPDIR': str(temporary), 'PYTHONPYCACHEPREFIX':str(home/'.cache/python'/cache_key), 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(config['port']),
           'APP_DATA_PATH': str(data), 'BOOK_DOCK_PATH': str(data / 'bookdock'), 'LD_LIBRARY_PATH': str(root / 'lib'),
           'FFMPEG_PATH': str(root / 'bin/ffmpeg'), 'FFPROBE_PATH': str(root / 'bin/ffprobe'),
           'KOBO_CLOUDSCRAPER_PYTHON': str(root / 'bin/python3'),
           'KOREADER_PLUGIN_PATH': str(root / 'app/koreader-plugin/bookorbit.koplugin')}
    if (root/'bin/tomato-downloader').is_file():env['TOMATO_DOWNLOADER_PATH']=str(root/'bin/tomato-downloader')
    return env


def child_setup(parent):
    signal.signal(signal.SIGTERM,signal.SIG_DFL)
    signal.signal(signal.SIGINT,signal.SIG_DFL)
    libc=ctypes.CDLL(None,use_errno=True)
    if libc.prctl(1,signal.SIGTERM,0,0,0)!=0 or os.getppid()!=parent:os._exit(125)


def supervise(root, state):
    config = configuration(state)
    stopped = [False]
    signal.signal(signal.SIGTERM, lambda *_: stopped.__setitem__(0, True))
    signal.signal(signal.SIGINT, lambda *_: stopped.__setitem__(0, True))
    atomic(state / 'service.pid.json', {'pid': os.getpid(), 'startTicks': ticks(os.getpid())})
    env = environment(root, state, config)
    try:
        with (state / 'application.log').open('ab', buffering=0) as output:
            parent_pid=os.getpid()
            for attempt in range(4):
                if stopped[0]:break
                child = subprocess.Popen([str(root / 'bin/node'), '--max-old-space-size=512', 'dist/main.js'], cwd=str(root / 'app'), env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True, preexec_fn=lambda:child_setup(parent_pid))
                try:
                    atomic(state/'child.pid.json',{'pid':child.pid,'startTicks':ticks(child.pid)})
                    while child.poll() is None and not stopped[0]:time.sleep(0.25)
                finally:
                    if child.poll() is None:
                        os.killpg(child.pid, signal.SIGTERM)
                        try:child.wait(timeout=15)
                        except subprocess.TimeoutExpired:os.killpg(child.pid, signal.SIGKILL);child.wait(timeout=5)
                (state/'child.pid.json').unlink(missing_ok=True)
                if stopped[0]:break
                atomic(state / 'last-exit.json', {'attempt': attempt + 1, 'code': child.returncode})
                for _ in range(min(2 ** attempt, 8) * 4):
                    if stopped[0]:break
                    time.sleep(0.25)
    finally:
        (state / 'service.pid.json').unlink(missing_ok=True)


def healthy(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open('http://127.0.0.1:' + str(port) + '/api/v1/health', timeout=2) as response:
            return response.status == 200 and json.load(response).get('status') == 'ok'
    except (OSError, ValueError):return False


def control(action, root, state):
    if action == 'supervise':supervise(root, state);return 0
    with (state / 'control.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if action == 'status':return 0 if alive(state) else 1
        if action == 'stop':
            if not alive(state):stop_orphan(root,state);return 0
            pid = json.loads((state / 'service.pid.json').read_text())['pid']
            os.kill(pid, signal.SIGTERM)
            for _ in range(100):
                if not alive(state):stop_orphan(root,state);return 0
                time.sleep(0.25)
            raise RuntimeError('Supervisor did not stop within the deadline')
        config = configuration(state)
        if alive(state):return 0 if child_identity(root,state) is not None and healthy(config['port']) else 1
        stop_orphan(root,state)
        # Never mistake another application listening on this port for our service.
        import socket
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', config['port']))
        (state / 'last-exit.json').unlink(missing_ok=True)
        (state / 'tmp').mkdir(exist_ok=True, mode=0o700)
        log = os.open(str(state / 'supervisor.log'), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            subprocess.Popen([sys.executable, str(pathlib.Path(__file__).resolve()), 'supervise', '--root', str(root), '--state', str(state)], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TMPDIR':str(state/'tmp')})
        finally:os.close(log)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if alive(state) and child_identity(root,state) is not None and healthy(config['port']):return 0
            if (state / 'last-exit.json').exists() and not alive(state):break
            time.sleep(0.5)
        if alive(state):os.kill(json.loads((state / 'service.pid.json').read_text())['pid'], signal.SIGTERM)
        raise RuntimeError('Native service did not become healthy; inspect private logs')


if __name__ == '__main__':
    parser = argparse.ArgumentParser();parser.add_argument('action', choices=('start', 'stop', 'status', 'supervise'));parser.add_argument('--root', required=True);parser.add_argument('--state', required=True)
    args = parser.parse_args()
    if os.geteuid() == 0:raise SystemExit('Run as the dedicated ordinary package account')
    os.umask(0o077)
    root=pathlib.Path(args.root).resolve(strict=True);state=pathlib.Path(args.state).resolve(strict=True)
    if state.stat().st_uid != os.geteuid() or state.stat().st_mode & 0o077:raise SystemExit('Owned private state directory required')
    try:raise SystemExit(control(args.action, root, state))
    except (OSError, ValueError, RuntimeError):raise SystemExit('Native lifecycle failed; production was not selected by this isolated candidate')
