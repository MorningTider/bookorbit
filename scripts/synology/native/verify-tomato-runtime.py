#!/usr/bin/env python3
"""Bootstrap the pinned helper on authenticated loopback without downloading a book."""
import argparse
import hashlib
import json
import os
import pathlib
import secrets
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

EXPECTED='d9db872448e3cda78a18eaa3c7ee162ce631251ed51eb789f8e6676abe118722'


def verify(binary,parent,output):
    if os.geteuid()==0:raise ValueError('Ordinary package account required')
    binary=pathlib.Path(binary).resolve(strict=True)
    data=binary.read_bytes()
    if hashlib.sha256(data).hexdigest()!=EXPECTED:raise ValueError('Unverified auxiliary binary')
    with tempfile.TemporaryDirectory(prefix='tomato-bootstrap-',dir=parent) as directory:
        root=pathlib.Path(directory);books=root/'books';books.mkdir(mode=0o700)
        executable=root/'downloader';executable.write_bytes(data);executable.chmod(0o700)
        (root/'config.yml').write_text(json.dumps({'save_path':str(books),'novel_format':'epub','use_official_api':True,'api_endpoints':[],'max_workers':1,'max_retries':1,'request_timeout':5,'auto_open_downloaded_files':False,'enable_audiobook':False}))
        with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
        password=secrets.token_hex(32)
        env={'PATH':'/usr/bin:/bin','HOME':str(root),'LANG':'C.UTF-8','CARGO':'bookorbit-pinned-release','TOMATO_WEB_ADDR':'127.0.0.1:'+str(port),'TOMATO_WEB_PASSWORD':password,'TMPDIR':str(root)}
        process=subprocess.Popen([str(executable),'--server','--data-dir',str(root)],cwd=str(root),env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        checks={}
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        base='http://127.0.0.1:'+str(port)
        try:
            deadline=time.monotonic()+45
            while time.monotonic()<deadline:
                if process.poll() is not None:raise RuntimeError('Auxiliary helper exited before readiness')
                try:
                    request=urllib.request.Request(base+'/api/status',headers={'x-tomato-password':password})
                    with opener.open(request,timeout=3) as response:
                        body=json.load(response);checks['authenticatedLoopbackStatus']=response.status==200 and isinstance(body,dict)
                    break
                except (OSError,ValueError):time.sleep(0.25)
            else:raise RuntimeError('Auxiliary helper readiness deadline exceeded')
            inodes=set()
            for fd in (pathlib.Path('/proc')/str(process.pid)/'fd').iterdir():
                try:
                    value=os.readlink(fd)
                    if value.startswith('socket:['):inodes.add(value[8:-1])
                except OSError:pass
            listeners=[]
            for name in ['tcp','tcp6']:
                for line in (pathlib.Path('/proc/net')/name).read_text().splitlines()[1:]:
                    fields=line.split()
                    if fields[9] in inodes and fields[3]=='0A':listeners.append(fields[1].split(':')[0])
            checks['onlyLoopbackListeners']=bool(listeners) and all(value in ['0100007F','00000000000000000000000001000000'] for value in listeners)
            try:
                with opener.open(base+'/api/status',timeout=3) as response:anonymous=response.status
            except urllib.error.HTTPError as error:anonymous=error.code
            checks['anonymousStatusRejected']=anonymous in [401,403]
            checks['ordinaryAccount']=os.geteuid()!=0
        finally:
            if process.poll() is None:
                os.killpg(process.pid,signal.SIGTERM)
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
    checks['processStopped']=process.poll() is not None
    report={'kind':'pinned-auxiliary-bootstrap','uid':os.geteuid(),'sha256':EXPECTED,'checks':checks,'passed':all(checks.values()),'bookDownloadPerformed':False,'temporaryDataRemoved':not root.exists()}
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:json.dump(report,stream,indent=2)
    print(json.dumps(report))
    if not report['passed']:raise RuntimeError('Auxiliary bootstrap acceptance incomplete')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);parser.add_argument('--work-parent',required=True);parser.add_argument('--output',required=True);a=parser.parse_args();verify(a.binary,a.work_parent,a.output)
