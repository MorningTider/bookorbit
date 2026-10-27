#!/usr/bin/env python3
"""Reviewed native-PG cutover, with explicit execution and pre-health rollback.
Default is a read-only readiness check. Never deletes old databases or volumes.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('prepare_native',HERE/'prepare-native-pg-migration.py')
prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
docker=prepare.docker
ROOT=pathlib.Path('/volume1/docker/bookorbit')
PGSTATE=pathlib.Path('/volume1/database/pg/state')
PGBACKUPS=pathlib.Path('/volume1/database/pg/backups')


def private_replace(path,content):
    info=path.stat();temporary=path.with_name('.'+path.name+'.native-pg-next')
    if temporary.exists():raise ValueError('A pending configuration file already exists')
    try:
        with temporary.open('xb') as target:
            target.write(content);target.flush();os.fsync(target.fileno())
        os.chmod(str(temporary),0o600);os.chown(str(temporary),info.st_uid,info.st_gid);temporary.replace(path)
    finally:
        if temporary.exists():temporary.unlink()


def source_sql(database,statement):
    env=dict(value.split('=',1) for value in database['Config']['Env'])
    result=subprocess.run(['docker','exec','bookorbit-db','psql','-X','-At','-v','ON_ERROR_STOP=1','-U',env['POSTGRES_USER'],'-d',env['POSTGRES_DB'],'-c',statement],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
    if result.returncode:raise RuntimeError('Source database readiness query failed')
    return result.stdout.strip()


def health_wait(timeout):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            with opener.open('http://127.0.0.1:8184/api/v1/health',timeout=3) as response:
                if response.status==200 and json.load(response).get('status')=='ok':return
        except (OSError,ValueError):pass
        time.sleep(3)
    raise TimeoutError('Production application did not become healthy')


def native_query(statement,database='postgres'):
    return prepare.package_python("import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;a=Admin();print(json.dumps(a.sql("+repr(statement)+","+repr(database)+")))")


def readiness(preflight,target):
    if os.geteuid()!=0:raise ValueError('NAS administrator required')
    if not re.fullmatch(r'bookorbit(?:_prod[a-z0-9_]*)?',target):raise ValueError('Use a dedicated BookOrbit production database')
    evidence=json.loads((preflight/'acceptance.json').read_text())
    profile=json.loads((preflight/'native-profile-validation.json').read_text())
    if profile.get('passed') is not True:raise ValueError('Persistent native deployment profile must pass validation')
    reboot=json.loads((PGSTATE/'reboot-10019-acceptance.json').read_text())
    if evidence.get('passed') is not True or reboot.get('passed') is not True:raise ValueError('Application and reboot acceptance must pass first')
    source=docker('GET','/containers/bookorbit-app/json');db=docker('GET','/containers/bookorbit-db/json')
    original_db=json.loads((preflight/'source-db.json').read_text())
    if db['Id']!=original_db['Id'] or db['Image']!=original_db['Image']:raise ValueError('Source database container changed after preflight')
    if source['Id']!=evidence['sourceContainerId'] or source['Image']!=evidence['sourceImageId']:raise ValueError('Source application changed after preflight')
    if source['State']['Status']!='running' or db['State']['Status']!='running':raise ValueError('Production must be running before cutover')
    for name,expected in evidence['configurationHashes'].items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=expected:raise ValueError('Persistent production configuration changed')
    network=docker('GET','/networks/bookorbit_default')
    if not any(row.get('Subnet')=='172.19.0.0/16' and row.get('Gateway')=='172.19.0.1' for row in network['IPAM']['Config']):raise ValueError('Production network differs from the accepted native listener')
    if native_query("SELECT count(*) FROM pg_database WHERE datname='"+target+"'")!='0' or native_query("SELECT count(*) FROM pg_roles WHERE rolname='"+target+"'")!='0':raise ValueError('The target database/role already exists; never overwrite it')
    if source_sql(db,"SELECT count(*) FROM book_source_jobs WHERE status IN ('queued','downloading','importing')")!='0':raise ValueError('Wait for active book-source jobs before cutover')
    return source,db,evidence


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--preflight-root',required=True,type=pathlib.Path);parser.add_argument('--target-database',default='bookorbit');parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    source,db,evidence=readiness(args.preflight_root,args.target_database)
    target=args.target_database
    plan={'ready':True,'sourceImage':source['Config']['Image'],'sourceDatabaseContainer':'bookorbit-db','targetNativeDatabase':target,'nativeAddress':'172.19.0.1:5433','applicationRoleConnectionLimit':24,'preflightTables':evidence['restore']['tables'],'freshBackupAfterStoppingApp':True,'preserveOldContainerAndVolumes':True,'stopLegacyDatabaseAfterSuccess':True,'automaticRollback':'before new application health is confirmed only','executeRequested':args.execute}
    print(json.dumps(plan),flush=True)
    if not args.execute:return
    stamp=datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    state=PGSTATE/('bookorbit-cutover-'+stamp);state.mkdir(mode=0o700)
    prepare.private_json(state/'original-app.json',source);prepare.private_json(state/'original-db.json',db)
    originals={name:(ROOT/name).read_bytes() for name in ('.env','docker-compose.yml')}
    for name,content in originals.items():
        p=state/('original-'+name.lstrip('.'));p.write_bytes(content);p.chmod(0o600)
    source_stopped=False;renamed=False;committed=False
    old_name='bookorbit-app-pre-nativepg-'+stamp.lower()
    try:
        source_stopped=True;docker('POST','/containers/bookorbit-app/stop?t=60')
        if source_sql(db,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")!='0':raise RuntimeError('Other source database clients remain; migration cancelled')
        backup=PGBACKUPS/('bookorbit-cutover-'+stamp)
        result=subprocess.run([sys.executable,str(HERE/'backup-container-db.py'),'--output',str(backup)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=900)
        if result.returncode:raise RuntimeError('Final source snapshot failed')
        backup_report=json.loads(result.stdout)
        app_data=next(m['Source'] for m in source['Mounts'] if m['Destination']=='/data')
        archive=backup/'application-data.tar'
        with archive.open('xb') as output:
            result=subprocess.run(['tar','-C',app_data,'-cf','-','.'],stdout=output,stderr=subprocess.PIPE,timeout=600)
        archive.chmod(0o600)
        if result.returncode:raise RuntimeError('Application data backup failed')
        print('FINAL_BACKUP_COMPLETE',flush=True)
        code="import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;a=Admin();print(json.dumps(a.restore_copy("+repr(str(backup))+","+repr(backup_report['database'])+","+repr(target)+","+repr(target)+",connection_limit=24)))"
        credentials=prepare.package_python(code);prepare.private_json(state/'native-credentials.json',credentials)
        manifest=json.loads((backup/'manifest.json').read_text())
        code="import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;a=Admin();expected="+repr(manifest['rowCounts'])+";actual={}\n"
        code+="for name in expected:\n schema,table=name.split('.',1);q=lambda s:chr(34)+s.replace(chr(34),chr(34)*2)+chr(34);actual[name]=int(a.sql('SELECT count(*) FROM '+q(schema)+'.'+q(table),"+repr(target)+"))\n"
        code+="print(json.dumps({'tables':len(actual),'allRowCountsMatch':actual==expected}))"
        counts=prepare.package_python(code)
        if not counts['allRowCountsMatch']:raise RuntimeError('Final restored row counts differ')
        code="import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;from app_connections import configure;a=Admin();print(json.dumps(configure(a,"+repr(target)+","+repr(target)+",'172.19.0.0/16','172.19.0.1')))"
        access=prepare.package_python(code)
        if access['restartRequired']:raise RuntimeError('The accepted private listener is missing')
        env=prepare.native_env(originals['.env'].decode(),credentials)
        compose=json.loads((args.preflight_root/'native-compose-blueprint.json').read_text())
        candidate=state/'native-compose.json';prepare.private_json(candidate,compose)
        env_path=state/'native.env';env_path.write_text(env);env_path.chmod(0o600)
        checked=subprocess.run(['docker','compose','-f',str(candidate),'--env-file',str(env_path),'config','--format','json'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=40)
        if checked.returncode:raise RuntimeError('Native deployment profile validation failed')
        rendered=json.loads(checked.stdout)['services']['app'];effective=rendered['environment'];old_env=dict(v.split('=',1) for v in source['Config']['Env'])
        if rendered['image']!=source['Config']['Image'] or effective.get('JWT_SECRET')!=old_env['JWT_SECRET']:raise ValueError('Application image or authentication configuration changed')
        if effective.get('POSTGRES_HOST')!='172.19.0.1' or effective.get('POSTGRES_PASSWORD')!=credentials['password'] or effective.get('POSTGRES_DB')!=target:raise ValueError('Native database environment did not resolve correctly')
        private_replace(ROOT/'.env',env.encode());private_replace(ROOT/'docker-compose.yml',(json.dumps(compose,indent=2)+'\n').encode())
        docker('POST','/containers/'+source['Id']+'/update',{'RestartPolicy':{'Name':'no','MaximumRetryCount':0}})
        renamed=True;docker('POST','/containers/'+source['Id']+'/rename?name='+old_name)
        result=subprocess.run(['docker','compose','-f',str(ROOT/'docker-compose.yml'),'--env-file',str(ROOT/'.env'),'up','-d','--no-deps','--no-build','--pull','never','app'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=120)
        if result.returncode:raise RuntimeError('Native database application deployment failed')
        print('APPLICATION_STARTING',flush=True)
        health_wait(300)
        current=docker('GET','/containers/bookorbit-app/json');live_env=dict(v.split('=',1) for v in current['Config']['Env'])
        if current['Image']!=source['Image'] or live_env.get('POSTGRES_HOST')!='172.19.0.1' or live_env.get('POSTGRES_DB')!=target:raise ValueError('Live application differs from the accepted target')
        if int(native_query("SELECT count(*) FROM pg_stat_activity WHERE datname='"+target+"' AND usename='"+target+"'"))<1:raise RuntimeError('No live application connection to native PostgreSQL')
        receipt={'cutoverCommitted':True,'sourceImagePreserved':True,'legacyApplication':old_name,'nativeDatabase':target,'nativePort':5433,'finalBackup':str(backup),'rowCountVerification':counts,'productionHealth':200,'rollbackPolicy':'New user writes must be preserved; do not point back to the stale DB after commitment.'}
        prepare.private_json(state/'committed.json',receipt);committed=True
        docker('POST','/containers/bookorbit-db/update',{'RestartPolicy':{'Name':'no','MaximumRetryCount':0}})
        docker('POST','/containers/bookorbit-db/stop?t=60')
        receipt['legacyDatabaseStoppedAndRetained']=True;prepare.private_json(state/'acceptance.json',receipt)
        print(json.dumps(receipt),flush=True)
    except Exception:
        if committed:
            print('Native cutover is committed; follow-up failed. Preserve new writes and inspect the private receipt.',file=sys.stderr)
            raise
        # This rollback is restricted to the initial readiness window. Once
        # committed, reversing the DB requires a new dump/restore of new writes.
        try:
            if renamed:
                try:
                    current=docker('GET','/containers/bookorbit-app/json')
                    if current['Id']!=source['Id']:
                        docker('POST','/containers/'+current['Id']+'/update',{'RestartPolicy':{'Name':'no','MaximumRetryCount':0}})
                        docker('POST','/containers/'+current['Id']+'/stop?t=30')
                        docker('POST','/containers/'+current['Id']+'/rename?name=bookorbit-app-nativepg-failed-'+stamp.lower())
                except RuntimeError:
                    pass
                old=docker('GET','/containers/'+source['Id']+'/json')
                if old['Name']!='/bookorbit-app':docker('POST','/containers/'+source['Id']+'/rename?name=bookorbit-app')
            for name,content in originals.items():private_replace(ROOT/name,content)
            docker('POST','/containers/'+source['Id']+'/update',{'RestartPolicy':source['HostConfig']['RestartPolicy']})
            if source_stopped:docker('POST','/containers/'+source['Id']+'/start')
            health_wait(180)
            prepare.private_json(state/'rollback.json',{'productionRestored':True,'nativeCopyRetained':True})
        except Exception as error:
            print('Rollback requires administrator attention: '+type(error).__name__,file=sys.stderr)
        raise

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as error:
        print('Native PG migration failed: '+type(error).__name__,file=sys.stderr);raise SystemExit(1)
