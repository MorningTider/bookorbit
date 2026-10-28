#!/usr/bin/env python3
"""Private native application cutover. Default only checks readiness.

A final stopped-app backup is restored into a new isolation database. Only that
copy has its paths rewritten and is promoted. The original database is retained.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE=pathlib.Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

prepare=load('prepare-native-pg-migration')
service=load('native-service')
planner=load('path-migration-plan')
ROOT=pathlib.Path('/var/packages/bookorbit-native/target')
STATE=pathlib.Path('/volume1/@appdata/bookorbit-native')
AUDITS=pathlib.Path('/volume1/database/pg/backups')


def private(path,value,uid=0,gid=0):
    with path.open('x') as stream:json.dump(value,stream,indent=2)
    path.chmod(0o600);os.chown(path,uid,gid)


def pg(code,timeout=900):
    return prepare.package_python("import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;from app_connections import configure;a=Admin();"+code,timeout)


def source_info(source):
    if not source['State']['Running']:raise ValueError('Production container must be running before preparation')
    env=dict(value.split('=',1) for value in source['Config']['Env'])
    url=urllib.parse.urlsplit(env['DATABASE_URL'])
    if url.hostname!='172.19.0.1' or url.port!=5433 or url.path!='/bookorbit':raise ValueError('Unexpected existing production database')
    expected={'/books':('/volume1/library',False),'/books/ebook':('/volume1/library/ebook',True),'/data':('/volume1/docker/bookorbit/data/app',True)}
    actual={m['Destination']:(m['Source'],m['RW']) for m in source['Mounts'] if m['Type']=='bind'}
    if actual!=expected or len(source['Mounts'])!=3:raise ValueError('Unexpected production mounts')
    for key in ['JWT_SECRET','SETUP_BOOTSTRAP_TOKEN','PODCAST_ENCRYPTION_KEY','BOOK_REQUEST_ENCRYPTION_KEY','EMAIL_ENCRYPTION_KEY','MIGRATION_ENCRYPTION_KEY']:
        if not env.get(key):raise ValueError('Missing production authentication or encryption configuration')
    return env


def copied_environment(env,database,role,password):
    result={key:value for key,value in env.items() if key in service.ALLOWED}
    result['DATABASE_URL']='postgres://'+urllib.parse.quote(role,safe='')+':'+urllib.parse.quote(password,safe='')+'@127.0.0.1:5433/'+database
    result['LIBRARY_BROWSE_ROOT']=planner.translate(env.get('LIBRARY_BROWSE_ROOT','/books'),[('/books','/volume1/library')])
    result['COVER_SLOTS_BACKFILL_MODE']='skip'
    return result


def copy_data(source,destination,uid,gid):
    if destination.exists():raise ValueError('Destination application data must be new')
    for parent,dirs,files in os.walk(source,followlinks=False):
        for name in dirs+files:
            item=pathlib.Path(parent,name)
            if item.is_symlink() or not (item.is_file() or item.is_dir()):raise ValueError('Review application-data special files before migrating')
    shutil.copytree(source,destination)
    for parent,dirs,files in os.walk(destination):
        os.chmod(parent,0o700);os.chown(parent,uid,gid)
        for name in files:os.chmod(os.path.join(parent,name),0o600);os.chown(os.path.join(parent,name),uid,gid)


def app_query(sql):
    return pg('print(json.dumps(a.sql('+repr(sql)+",'bookorbit')))" )


def readiness():
    if os.geteuid()!=0:raise ValueError('NAS administrator required')
    meta=json.loads((ROOT/'acceptance-build.json').read_text())
    if meta.get('productionEnabled') is not True:raise ValueError('Install a verified production-capable package first')
    config=json.loads((STATE/'service.json').read_text())
    if config['mode']!='isolated':raise ValueError('Cutover requires the accepted isolated installation')
    source=prepare.docker('GET','/containers/bookorbit-app/json');env=source_info(source)
    if app_query("SELECT count(*) FROM book_source_jobs WHERE status IN ('queued','downloading','importing')")!='0':raise ValueError('Wait for active source downloads')
    for name in ['audit-native-paths.cjs','replay-path-plan.cjs']:
        if not (HERE/name).is_file():raise ValueError('Reviewed migration program missing')
    account=pwd.getpwnam('bookorbit-native')
    access=subprocess.run(['sudo','-u','bookorbit-native','python3','-c',"import os;raise SystemExit(0 if os.access('/volume1/library/ebook',os.W_OK|os.X_OK) else 1)"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    if access.returncode:raise ValueError('Grant and verify scoped ebook write access before migration')
    return source,env,account


def node(script,env,args=(),output=None):
    values={'PATH':'/usr/bin:/bin','LD_LIBRARY_PATH':str(ROOT/'lib'),'NODE_PATH':str(ROOT/'app/node_modules'),**env}
    result=subprocess.run([str(ROOT/'bin/node'),str(HERE/script),*map(str,args)],env=values,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
    if result.returncode:raise RuntimeError('Native path operation failed: '+script)
    value=json.loads(result.stdout)
    if output:private(output,value)
    return value


def health(port):
    try:
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:'+str(port)+'/api/v1/health',timeout=5) as response:return response.status==200 and json.load(response)['status']=='ok'
    except (OSError,ValueError):return False


def execute(source,env,account):
    stamp=datetime.datetime.utcnow().strftime('%Y%m%d%H%M%S')
    work=AUDITS/('bookorbit-native-cutover-'+stamp);work.mkdir(mode=0o700)
    private(work/'source-container.json',source)
    original=(STATE/'service.json').read_bytes();(work/'isolated-service.json').write_bytes(original);(work/'isolated-service.json').chmod(0o600)
    clone='bookorbit_spk_pathcheck_cutover_'+stamp;target='bookorbit_prod_spk_'+stamp
    stopped=False;new_data=False;new_config=False;started=False;activated=False
    old_data=STATE/('data-before-cutover-'+stamp)
    maps=[{'from':'/books','to':'/volume1/library'},{'from':'/data','to':str(STATE/'data')}]
    try:
        prepare.docker('POST','/containers/bookorbit-app/stop?t=60');stopped=True
        if app_query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")!='0':raise RuntimeError('Other application database clients remain')
        if app_query("SELECT count(*) FROM book_source_jobs WHERE status IN ('queued','downloading','importing')")!='0':raise RuntimeError('Source job became active during cutover')
        backup=pg('print(json.dumps(a.backup()))');private(work/'database-backup.json',backup)
        data_source=pathlib.Path('/volume1/docker/bookorbit/data/app')
        with (work/'application-data.tar').open('xb') as stream:
            subprocess.run(['tar','-C',str(data_source),'-cf','-','.'],stdout=stream,stderr=subprocess.PIPE,check=True,timeout=300)
        (work/'application-data.tar').chmod(0o600)
        subprocess.run(['tar','-tf',str(work/'application-data.tar')],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True,timeout=120)
        checksum=hashlib.sha256()
        with (work/'application-data.tar').open('rb') as stream:
            for block in iter(lambda:stream.read(1024*1024),b''):checksum.update(block)
        private(work/'application-data-backup.json',{'sha256':checksum.hexdigest(),'bytes':(work/'application-data.tar').stat().st_size})
        print(json.dumps({'phase':'final-backup-complete','audit':str(work)}),flush=True)
        credentials=pg('print(json.dumps(a.restore_copy('+repr(backup['backup'])+",'bookorbit',"+repr(clone)+','+repr(clone)+',connection_limit=24)))')
        private(work/'copy-credentials.json',credentials)
        pg('print(json.dumps(configure(a,'+repr(clone)+','+repr(clone)+",'127.0.0.1/32','127.0.0.1')))" )
        copied=copied_environment(env,clone,clone,credentials['password'])
        snapshot=node('audit-native-paths.cjs',{'DATABASE_URL':copied['DATABASE_URL'],'BOOKORBIT_PATH_MAP_JSON':json.dumps(maps)},output=work/'snapshot.json')
        plan=planner.plan(snapshot,maps);private(work/'plan.json',plan)
        if not plan['readyForIsolationReplay']:raise RuntimeError('Final copied database path plan is blocked')
        private(work/'copy-connection.json',{'DATABASE_URL':copied['DATABASE_URL']})
        replay=node('replay-path-plan.cjs',{},[work/'plan.json',work/'copy-connection.json'],work/'replay.json')
        if replay.get('passed') is not True:raise RuntimeError('Copy rewrite failed')
        after=node('audit-native-paths.cjs',{'DATABASE_URL':copied['DATABASE_URL'],'BOOKORBIT_PATH_MAP_JSON':json.dumps(maps)},output=work/'after-paths.json')
        if after['matches'] or after.get('auditComplete') is not True:raise RuntimeError('Copied database retains container paths')
        pg('a.sql('+repr('ALTER DATABASE "'+clone+'" RENAME TO "'+target+'"')+');print(json.dumps({"promotedCopy":True}))')
        pg('print(json.dumps(configure(a,'+repr(target)+','+repr(clone)+",'127.0.0.1/32','127.0.0.1')))" )
        subprocess.run(['/usr/syno/bin/synopkg','stop','bookorbit-native'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=180)
        (STATE/'data').rename(old_data);new_data=True
        copy_data(data_source,STATE/'data',account.pw_uid,account.pw_gid)
        config={'schemaVersion':1,'mode':'production','port':8184,'environment':copied_environment(env,target,clone,credentials['password'])}
        candidate=STATE/('service-cutover-'+stamp+'.json');private(candidate,config,account.pw_uid,account.pw_gid)
        candidate.replace(STATE/'service.json');new_config=True
        subprocess.run(['/usr/syno/bin/synopkg','start','bookorbit-native'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=240);started=True
        if not health(8184):raise RuntimeError('Native production application did not become healthy')
        # No automatic rollback after exposing a healthy native service: new user writes may exist.
        activated=True
        prepare.docker('POST','/containers/bookorbit-app/update',{'RestartPolicy':{'Name':'no','MaximumRetryCount':0}})
        receipt={'passed':True,'phase':'native-service-healthy','productionDatabase':target,'originalDatabasePreserved':'bookorbit','sourceContainerPreserved':source['Id'],'automaticRollbackDisabledAfterHealth':True,'backup':backup['backup'],'audit':str(work)}
        private(work/'activation.json',receipt);print(json.dumps(receipt),flush=True)
    except BaseException:
        if not activated:
            if started or new_config:subprocess.run(['/usr/syno/bin/synopkg','stop','bookorbit-native'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
            if new_config:
                restore=STATE/('restore-service-'+stamp+'.json');restore.write_bytes(original);restore.chmod(0o600);os.chown(restore,account.pw_uid,account.pw_gid);restore.replace(STATE/'service.json')
            if new_data:
                if (STATE/'data').exists():(STATE/'data').rename(STATE/('data-failed-cutover-'+stamp))
                old_data.rename(STATE/'data')
            if stopped:prepare.docker('POST','/containers/bookorbit-app/start')
        private(work/'failure.json',{'activated':activated,'originalDatabaseUnchanged':True,'oldContainerRestartRequested':stopped and not activated})
        raise RuntimeError('Cutover did not finish; inspect private audit. Do not overwrite databases.') from None


def main():
    p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');args=p.parse_args()
    source,env,account=readiness()
    print(json.dumps({'ready':True,'executeRequested':args.execute,'newDatabaseCopy':True,'preserveOriginalDatabase':True,'preserveAuthentication':True,'sourceImage':source['Config']['Image']}),flush=True)
    if args.execute:execute(source,env,account)


if __name__=='__main__':main()
