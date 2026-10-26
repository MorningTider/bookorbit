#!/usr/bin/env python3
"""Probe the pinned container's Node on DSM without changing any running service."""
import argparse
import hashlib
import json
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--container', default='bookorbit-app-verify')
parser.add_argument('--expected-image', required=True)
parser.add_argument('--run-as', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--work-root', required=True)
args = parser.parse_args()
assert os.geteuid() == 0, 'Root is required only for Docker export and changing the probe owner'
docker = '/var/packages/ContainerManager/target/usr/bin/docker'

def capture(command, timeout=30):
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Probe command failed: ' + result.stderr.strip()[:1500])
    return result.stdout.strip()

info = json.loads(capture([docker, 'inspect', args.container]))[0]
assert info['Config']['Image'] == args.expected_image, 'Unexpected source image'
assert info['State']['Running'], 'Source container must be running'
owner = pwd.getpwnam(args.run_as)
assert owner.pw_uid != 0, 'The native execution must be unprivileged'
output = pathlib.Path(args.output)
assert output.is_absolute() and not output.exists(), 'Use a new absolute report path'
output.parent.mkdir(parents=True, exist_ok=True)
work_root = pathlib.Path(args.work_root)
assert work_root.is_absolute() and work_root.is_dir(), 'Use an existing work directory'
root = pathlib.Path(tempfile.mkdtemp(prefix='bookorbit-node-probe-', dir=str(work_root)))
report = {'sourceImage': args.expected_image, 'sourceImageId': info['Image'], 'hostKernel': os.uname().release, 'architecture': os.uname().machine}
try:
    try:
        report['hostLibc'] = os.confstr('CS_GNU_LIBC_VERSION')
    except (ValueError, OSError):
        report['hostLibc'] = None
    libraries = capture([docker, 'exec', args.container, 'ldd', '/usr/local/bin/node'])
    paths = sorted(set(re.findall(r'/(?:lib|usr/lib)/[^\s()]+', libraries)))
    assert '/lib/ld-musl-x86_64.so.1' in paths and len(paths) <= 20, 'Unexpected Node runtime dependencies'
    (root / 'lib').mkdir()
    (root / 'bin').mkdir()
    artifacts = []
    for source in ['/usr/local/bin/node'] + paths:
        destination = root / ('bin' if source.endswith('/node') else 'lib') / pathlib.Path(source).name
        subprocess.run([docker, 'cp', '-L', args.container + ':' + source, str(destination)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
        with destination.open('rb') as binary:
            assert binary.read(4) == b'\x7fELF', 'Only expected ELF files may be executed'
            binary.seek(0)
            digest = hashlib.sha256()
            for chunk in iter(lambda: binary.read(1024 * 1024), b''):
                digest.update(chunk)
        artifacts.append({'source': source, 'bytes': destination.stat().st_size, 'sha256': digest.hexdigest(), 'mode': oct(destination.stat().st_mode & 0o777)})
    for directory, _, files in os.walk(str(root)):
        os.chown(directory, owner.pw_uid, owner.pw_gid)
        for name in files:
            os.chown(os.path.join(directory, name), owner.pw_uid, owner.pw_gid)
    probe = "const fs=require('node:fs'),c=require('node:crypto');if(Number(process.versions.node.split('.')[0])<24)throw Error('Node24+ required');if(process.getuid()===0||fs.existsSync('/.dockerenv'))throw Error('Expected unprivileged DSM host execution');console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,uid:process.getuid(),execPath:process.execPath,outsideDocker:true,crypto:c.createHash('sha256').update('BookOrbit').digest('hex')}))"
    command = ['sudo', '-u', args.run_as, '--', str(root / 'lib/ld-musl-x86_64.so.1'), '--library-path', str(root / 'lib'), str(root / 'bin/node'), '-e', probe]
    report['artifacts'] = artifacts
    report['nativeExecution'] = json.loads(capture(command))
    report['passed'] = True
except Exception as error:
    report['passed'] = False
    report['error'] = str(error)[:1500]
    raise
finally:
    shutil.rmtree(str(root))
    report['temporaryRuntimeRemoved'] = not root.exists()
    output.write_text(json.dumps(report, indent=2))
    output.chmod(0o600)
print(json.dumps(report))
