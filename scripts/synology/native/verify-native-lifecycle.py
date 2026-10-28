#!/usr/bin/env python3
"""Exercise process control with a synthetic Node HTTP app, never a real database."""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time


def verify(root, output, node_root=None):
    if os.geteuid()==0:raise ValueError('Ordinary user acceptance required')
    output=pathlib.Path(output)
    if output.exists():raise ValueError('Report output must be new')
    script=pathlib.Path(__file__).with_name('native-service.py').resolve()
    checks={}
    with tempfile.TemporaryDirectory(prefix='native-lifecycle-',dir=root) as directory:
        work=pathlib.Path(directory);package=work/'package';state=work/'state'
        state.mkdir(mode=0o700)
        for name in ['bin','lib','app/dist']:(package/name).mkdir(parents=True,exist_ok=True)
        source=pathlib.Path(node_root) if node_root else None
        if source and (source/'lib').is_dir():
            for library in (source/'lib').iterdir():
                if library.is_file():shutil.copyfile(library,package/'lib'/library.name)
        shutil.copyfile(source/'bin/node' if source else '/usr/local/bin/node',package/'bin/node');(package/'bin/node').chmod(0o755)
        (package/'app/dist/main.js').write_text("const fs=require('fs'),http=require('http');const p=process.env.APP_DATA_PATH+'/boots.json';let count=0;try{count=JSON.parse(fs.readFileSync(p)).count}catch{}fs.writeFileSync(p,JSON.stringify({pid:process.pid,count:count+1}));http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({status:'ok'}))}).listen(Number(process.env.PORT),process.env.HOST);")
        with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
        config={'schemaVersion':1,'mode':'isolated','port':port,'environment':{'DATABASE_URL':'postgres://unused:unused@127.0.0.1:5433/bookorbit_spk_pathcheck_synthetic','JWT_SECRET':'test-isolation-'+'a'*40}}
        (state/'service.json').write_text(json.dumps(config));(state/'service.json').chmod(0o600)
        def control(action,timeout=30):
            return subprocess.run([sys.executable,str(script),action,'--root',str(package),'--state',str(state)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
        try:
            started=control('start')
            if started.returncode:
                diagnostics=started.stderr.decode(errors='replace')
                for log in ['supervisor.log','application.log']:
                    if (state/log).exists():diagnostics+='\n'+(state/log).read_text(errors='replace')[-1500:]
                raise AssertionError(diagnostics)
            first=json.loads((state/'service.pid.json').read_text())
            assert control('status').returncode==0
            checks['startAndStatus']=True
            assert control('start').returncode==0 and json.loads((state/'service.pid.json').read_text())==first
            checks['duplicateStartIdempotent']=True
            boots=state/'data/boots.json';child=json.loads(boots.read_text());os.kill(child['pid'],signal.SIGKILL)
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                current=json.loads(boots.read_text())
                if current['count']>=2 and current['pid']!=child['pid']:break
                time.sleep(0.2)
            else:raise AssertionError('Crashed child was not replaced')
            assert json.loads((state/'service.pid.json').read_text())==first
            checks['childCrashRestartsWithinSameSupervisor']=True
            assert control('stop').returncode==0 and control('status').returncode!=0
            assert not pathlib.Path('/proc/'+str(current['pid'])).exists()
            checks['stopLeavesNoChild']=True
            assert control('stop').returncode==0
            checks['duplicateStopIdempotent']=True
            assert control('start').returncode==0 and control('stop').returncode==0
            checks['stoppedServiceRestartsOnSamePort']=True
            # Reusing our unrelated live PID must never allow the controller to signal us.
            token=pathlib.Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19]
            (state/'service.pid.json').write_text(json.dumps({'pid':os.getpid(),'startTicks':token}))
            assert control('status').returncode!=0 and control('stop').returncode==0
            checks['unrelatedLivePidRejected']=True
            (state/'service.pid.json').unlink()
            with socket.socket() as occupied:
                occupied.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                occupied.bind(('127.0.0.1',port));occupied.listen()
                assert control('start').returncode!=0
                assert not (state/'service.pid.json').exists()
            checks['occupiedPortRejectedBeforeSpawn']=True
        finally:
            control('stop')
    report={'kind':'synthetic-process-lifecycle','uid':os.geteuid(),'controllerSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'checks':checks,'passed':all(checks.values()),'temporaryApplicationRemoved':True,'databaseUsed':False}
    fd=os.open(str(output),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as target:json.dump(report,target,indent=2)
    print(json.dumps(report))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--work-parent',required=True);p.add_argument('--output',required=True);p.add_argument('--node-root');a=p.parse_args();verify(a.work_parent,a.output,a.node_root)
