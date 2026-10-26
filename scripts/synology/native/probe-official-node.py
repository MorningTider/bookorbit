#!/usr/bin/env python3
"""Check a verified official Node archive on DSM as an ordinary user."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tarfile
import tempfile

p = argparse.ArgumentParser()
p.add_argument('--archive', required=True)
p.add_argument('--sha256', required=True)
p.add_argument('--version', required=True)
p.add_argument('--output', required=True)
p.add_argument('--libatomic')
p.add_argument('--libatomic-sha256')
p.add_argument('--sharp-payload')
p.add_argument('--sharp-sha256')
p.add_argument('--work-root', default=str(pathlib.Path.home()))
a = p.parse_args()
assert os.uname().sysname == 'Linux' and os.uname().machine == 'x86_64', 'This probe requires Linux x64'
assert os.geteuid() != 0, 'Run the official runtime probe as an ordinary user'
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', a.version)
assert re.fullmatch(r'[0-9a-f]{64}', a.sha256)
archive = pathlib.Path(a.archive)
hash_value = hashlib.sha256()
with archive.open('rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        hash_value.update(chunk)
assert hash_value.hexdigest() == a.sha256, 'Official archive hash mismatch'
output = pathlib.Path(a.output)
assert not output.exists(), 'Do not overwrite a previous probe report'
root = pathlib.Path(tempfile.mkdtemp(prefix='bookorbit-official-node-', dir=str(pathlib.Path(a.work_root).resolve())))
report = {'version': a.version, 'archiveSha256': a.sha256, 'hostKernel': os.uname().release, 'hostLibc': os.confstr('CS_GNU_LIBC_VERSION')}
try:
    with tarfile.open(str(archive), 'r:xz') as bundle:
        for name in ['bin/node', 'LICENSE']:
            member = bundle.getmember('node-v' + a.version + '-linux-x64/' + name)
            assert member.isfile(), 'Only expected regular archive files are used'
            destination = root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(member) as source, destination.open('wb') as target:
                shutil.copyfileobj(source, target, 1024 * 1024)
            destination.chmod(0o755 if name == 'bin/node' else 0o600)
    probe_env = os.environ.copy()
    if a.libatomic:
        atomic = pathlib.Path(a.libatomic).read_bytes()
        assert atomic[:4] == b'\x7fELF' and hashlib.sha256(atomic).hexdigest() == a.libatomic_sha256, 'Private libatomic hash mismatch'
        library = root / 'lib'
        library.mkdir()
        (library / 'libatomic.so.1').write_bytes(atomic)
        (library / 'libatomic.so.1').chmod(0o600)
        probe_env['LD_LIBRARY_PATH'] = str(library)
        report['libatomicSha256'] = a.libatomic_sha256
    child = root / 'child.cjs'
    child.write_text("process.send({version:process.version,uid:process.getuid()});process.disconnect();")
    code = """const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const root=process.argv[1];assert.equal(process.getuid()===0,false);assert.equal(fs.existsSync('/.dockerenv'),false);assert.equal(process.execPath,fs.realpathSync(path.join(root,'bin/node')));assert.equal(cp.execFileSync(process.execPath,['-p','process.version'],{encoding:'utf8'}).trim(),process.version);
await new Promise((resolve,reject)=>{let result;const child=cp.fork(path.join(root,'child.cjs'),[],{silent:true});const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Fork IPC timed out'))},10000);child.once('message',m=>result=m);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);try{assert.equal(code,0);assert.equal(result.version,process.version);assert.equal(result.uid,process.getuid());resolve()}catch(e){reject(e)}})});
console.log(JSON.stringify({node:process.version,uid:process.getuid(),outsideDocker:true,execPathCorrect:true,childExec:true,forkIpc:true}));})().catch(e=>{console.error(e.message);process.exitCode=1});"""
    run = subprocess.run([str(root / 'bin/node'), '-e', code, str(root)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, env=probe_env)
    if run.returncode:
        raise RuntimeError(run.stderr.strip()[:1500])
    report['nativeExecution'] = json.loads(run.stdout)
    if a.sharp_payload:
        payload = pathlib.Path(a.sharp_payload)
        assert hashlib.sha256(payload.read_bytes()).hexdigest() == a.sharp_sha256, 'Sharp probe hash mismatch'
        sharp_root = root / 'sharp-probe'
        sharp_root.mkdir()
        with tarfile.open(str(payload), 'r:gz') as bundle:
            assert all(not pathlib.PurePosixPath(m.name).is_absolute() and '..' not in pathlib.PurePosixPath(m.name).parts and (m.isfile() or m.isdir()) for m in bundle.getmembers())
            bundle.extractall(str(sharp_root))
        run = subprocess.run([str(root / 'bin/node'), str(sharp_root / 'probe.cjs')], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, env=probe_env)
        if run.returncode:
            raise RuntimeError(run.stderr.strip()[:1500])
        report['sharpExecution'] = json.loads(run.stdout)
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
