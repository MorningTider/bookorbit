#!/usr/bin/env python3
"""Exercise candidate lifecycle upgrade guards without a database or installed package."""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile


def verify(parent,output):
    if os.geteuid()==0:raise ValueError('Run under an ordinary account')
    here=pathlib.Path(__file__).resolve().parent
    checks={}
    with tempfile.TemporaryDirectory(prefix='native-upgrade-',dir=parent) as temporary:
        root=pathlib.Path(temporary);package=root/'package';state=root/'state'
        package.mkdir();state.mkdir(mode=0o700)
        shutil.copyfile(here/'native-service.py',package/'native-service.py')
        shutil.copyfile(here/'schema-upgrade-policy.py',package/'schema-upgrade-policy.py')
        original=b'{"schemaVersion":1,"mode":"isolated","testSecret":"synthetic-only"}\n'
        (state/'service.json').write_bytes(original);(state/'service.json').chmod(0o600)
        (state/'data').mkdir();(state/'data/keep.txt').write_text('retain application state')
        metadata={'applicationMigrationSha256':'a'*64}
        (package/'acceptance-build.json').write_text(json.dumps(metadata))
        env={**os.environ,'SYNOPKG_PKGDEST':str(package),'SYNOPKG_PKGVAR':str(state)}
        def call(name):return subprocess.run(['/bin/sh',str(here/'spk/scripts'/name)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        assert call('preupgrade').returncode==0
        guard=json.loads((state/'upgrade-guard.json').read_text());backup=pathlib.Path(guard['configurationBackup'])
        assert (backup/'service.json').read_bytes()==original and (backup/'service.json').stat().st_mode&0o777==0o600
        checks['privateConfigurationBackup']=True
        assert call('postupgrade').returncode==0
        checks['unchangedSchemaAccepted']=True
        (package/'acceptance-build.json').write_text(json.dumps({'applicationMigrationSha256':'b'*64}))
        assert call('postupgrade').returncode!=0
        checks['unverifiedSchemaChangeRejected']=True
        assert (state/'service.json').read_bytes()==original and (state/'data/keep.txt').read_text()=='retain application state'
        checks['persistentConfigurationAndDataRetained']=True
        (state/'upgrade-guard.json').unlink()
        assert call('postupgrade').returncode!=0
        checks['missingUpgradeEvidenceRejected']=True
    report={'kind':'synthetic-upgrade-guards','uid':os.geteuid(),'checks':checks,'passed':all(checks.values()),'databaseUsed':False,'temporaryStateRemoved':True}
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as target:json.dump(report,target,indent=2)
    print(json.dumps(report))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--work-parent',required=True);parser.add_argument('--output',required=True);a=parser.parse_args();verify(a.work_parent,a.output)
