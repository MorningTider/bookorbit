#!/usr/bin/env python3
"""Online preparation only. Never stops or switches the production application.
Credentials and source configuration remain in private NAS files/process memory.
"""
import argparse
import base64
import concurrent.futures
import copy
import datetime
import hashlib
import hmac
import importlib.util
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('native_stage',HERE/'stage-native-pg-app.py')
stage_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage_module)
docker=stage_module.docker


def private_json(path,value):
    with path.open('x',encoding='utf-8') as target:
        json.dump(value,target,indent=2);target.flush();os.fsync(target.fileno())
    path.chmod(0o600)


def native_compose(config,env_keys=()):
    result=copy.deepcopy(config)
    if 'app' not in result.get('services',{}) or 'postgres' not in result['services']:
        raise ValueError('Expected the current BookOrbit app/postgres deployment')
    del result['services']['postgres']
    app=result['services']['app']
    dependencies=app.get('depends_on',{})
    if isinstance(dependencies,dict):dependencies.pop('postgres',None)
    elif isinstance(dependencies,list):dependencies=[name for name in dependencies if name!='postgres']
    else:raise ValueError('Unexpected dependency format')
    if dependencies:app['depends_on']=dependencies
    else:app.pop('depends_on',None)
    app['image']='${APP_IMAGE?required}'
    environment=app.setdefault('environment',{})
    for key in env_keys:
        if key in environment and key!='NODE_ENV':environment[key]='${'+key+'?required}'
    for key in ('POSTGRES_HOST','POSTGRES_PORT','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB','DATABASE_URL'):
        environment[key]='${'+key+'?required}'
    return result


def native_env(original,credentials):
    values={
        'POSTGRES_HOST':'172.19.0.1','POSTGRES_PORT':'5433',
        'POSTGRES_USER':credentials['role'],'POSTGRES_DB':credentials['database'],
        'POSTGRES_PASSWORD':credentials['password'],
        'DATABASE_URL':'postgres://'+urllib.parse.quote(credentials['role'],safe='')+':'+urllib.parse.quote(credentials['password'],safe='')+'@172.19.0.1:5433/'+urllib.parse.quote(credentials['database'],safe=''),
    }
    lines=[];seen=set()
    for line in original.splitlines():
        match=re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=',line)
        key=match.group(1) if match else None
        if key in values:
            if key not in seen:lines.append(key+'='+json.dumps(values[key]))
            seen.add(key)
        else:lines.append(line)
    lines.extend(key+'='+json.dumps(value) for key,value in values.items() if key not in seen)
    return '\n'.join(lines)+'\n'


def package_python(code,timeout=600):
    process=subprocess.run(['sudo','-u','postgresql18','python3','-'],input=code,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if process.returncode:raise RuntimeError('Native PG preparation failed; production unchanged')
    return json.loads(process.stdout)


def probe_config(source,credentials,app_path):
    config=copy.deepcopy(source['Config']);host=copy.deepcopy(source['HostConfig'])
    env=dict(value.split('=',1) for value in config['Env'])
    env.update({'POSTGRES_HOST':'172.30.77.1','POSTGRES_PORT':'5433','POSTGRES_USER':credentials['role'],'POSTGRES_DB':credentials['database'],'POSTGRES_PASSWORD':credentials['password'],'DATABASE_URL':'postgres://'+urllib.parse.quote(credentials['role'],safe='')+':'+urllib.parse.quote(credentials['password'],safe='')+'@172.30.77.1:5433/'+credentials['database'],'JWT_SECRET':secrets.token_hex(32),'SETUP_BOOTSTRAP_TOKEN':secrets.token_hex(32),'COVER_SLOTS_BACKFILL_MODE':'skip'})
    config['Env']=[key+'='+value for key,value in env.items()]
    config['Image']=source['Image'];config.pop('Hostname',None);config.pop('Domainname',None)
    config['Labels']={'bookorbit.acceptance':'native-pg-preflight'}
    config['Entrypoint']=['/bin/nice','-n','10']+(config.get('Entrypoint') or [])
    binds=[]
    for mount in source['Mounts']:
        if mount['Type']!='bind':raise ValueError('Unexpected application mount')
        if mount['Destination']=='/data':binds.append(str(app_path)+':/data:rw')
        elif mount['Destination'].startswith('/books'):binds.append(mount['Source']+':'+mount['Destination']+':ro')
        else:raise ValueError('Unreviewed application mount')
    host.update({'Binds':binds,'NetworkMode':'bookorbit-nativepg-acceptance','PortBindings':{},'RestartPolicy':{'Name':'no','MaximumRetryCount':0},'Memory':1024*1024*1024,'NanoCpus':0,'CpuShares':0,'CpuPeriod':0,'CpuQuota':0,'PidsLimit':256,'AutoRemove':False})
    config['HostConfig']=host
    return config,env


def functional_probe(address,secret,claims):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    claims={**claims,'iat':int(time.time()),'exp':int(time.time())+240}
    def encode(value):return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=')
    payload=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode(claims)
    token=(payload+b'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),payload,hashlib.sha256).digest()).rstrip(b'=')).decode()
    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
    def request(path,body=None):
        req=urllib.request.Request(address+'/api/v1'+path,headers=headers,data=json.dumps(body).encode() if body is not None else None)
        with opener.open(req,timeout=25) as response:return response.status,json.load(response)
    status,health=request('/health')
    status,query=request('/books/query',{'pagination':{'page':0,'size':5}})
    checks={'databaseHealth':health.get('status')=='ok','bookQuery':status in (200,201)}
    if not query['items']:raise ValueError('The production snapshot has no representative book')
    book_id=int(query['items'][0]['id'])
    status,detail=request('/books/'+str(book_id));checks['bookDetail']=status==200
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        checks['eightParallelDetails']=list(pool.map(lambda _:request('/books/'+str(book_id))[0],range(8)))==[200]*8
    files=detail.get('files') or []
    if not files:raise ValueError('Representative book has no file')
    req=urllib.request.Request(address+'/api/v1/books/files/'+str(int(files[0]['id']))+'/serve',headers={**headers,'Range':'bytes=0-4095'})
    with opener.open(req,timeout=25) as response:
        content=response.read(4097);match=re.fullmatch(r'bytes 0-(\d+)/(\d+)',response.headers.get('Content-Range',''))
        checks['fileRange']=response.status==206 and bool(match) and 0<len(content)<=4096 and len(content)==int(match.group(1))+1
    try:opener.open(address+'/api/v1/libraries',timeout=10);checks['anonymousRejected']=False
    except urllib.error.HTTPError as error:checks['anonymousRejected']=error.code==401
    if not all(checks.values()):raise RuntimeError('Native database application acceptance failed')
    return {'checks':checks,'bookTotal':query['total'],'bookId':book_id,'passed':True}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--stage-root',required=True,type=pathlib.Path);parser.add_argument('--probe-database',required=True);args=parser.parse_args()
    if os.geteuid()!=0:raise ValueError('NAS administrator required for private container inspection')
    if not re.fullmatch(r'bookorbit_preflight_[0-9]{8}(?:_[0-9]{1,4})?',args.probe_database):raise ValueError('Use a dedicated preflight database')
    stage=args.stage_root
    if not stage.is_absolute() or stage.exists() or stage.is_symlink():raise ValueError('Use a new private stage directory')
    stage.mkdir(mode=0o700)
    source=docker('GET','/containers/bookorbit-app/json');database=docker('GET','/containers/bookorbit-db/json')
    if source['State']['Status']!='running' or database['State']['Status']!='running':raise ValueError('Production must be healthy during preparation')
    private_json(stage/'source-app.json',source);private_json(stage/'source-db.json',database)
    root=pathlib.Path('/volume1/docker/bookorbit')
    for name in ('.env','docker-compose.yml'):
        path=stage/('original-'+name.lstrip('.'));path.write_bytes((root/name).read_bytes());path.chmod(0o600)
    before={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('.env','docker-compose.yml')}
    compose=subprocess.run(['docker','compose','-f',str(root/'docker-compose.yml'),'--env-file',str(root/'.env'),'config','--format','json'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=40)
    if compose.returncode:raise RuntimeError('Cannot read the persistent deployment profile')
    env_keys=re.findall(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=',(root/'.env').read_text(),re.MULTILINE)
    blueprint=native_compose(json.loads(compose.stdout),env_keys);private_json(stage/'native-compose-blueprint.json',blueprint)
    backup=pathlib.Path('/volume1/database/pg/backups')/('bookorbit-preflight-'+datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ'))
    result=subprocess.run([sys.executable,str(HERE/'backup-container-db.py'),'--output',str(backup)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=900)
    if result.returncode:raise RuntimeError('Consistent production backup failed')
    backup_report=json.loads(result.stdout);print('CONSISTENT_BACKUP_READY',backup_report['tables'],flush=True)
    code="import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin; a=Admin(); print(json.dumps(a.restore_copy("+repr(str(backup))+","+repr(backup_report['database'])+","+repr(args.probe_database)+","+repr(args.probe_database)+",connection_limit=24)))"
    credentials=package_python(code);private_json(stage/'probe-credentials.json',credentials)
    manifest=json.loads((backup/'manifest.json').read_text())
    code="import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;a=Admin();expected="+repr(manifest['rowCounts'])+";actual={}\n"
    code+="for name in expected:\n schema,table=name.split('.',1);q=lambda s:chr(34)+s.replace(chr(34),chr(34)*2)+chr(34);actual[name]=int(a.sql('SELECT count(*) FROM '+q(schema)+'.'+q(table),"+repr(args.probe_database)+"))\n"
    code+="print(json.dumps({'tables':len(actual),'allRowCountsMatch':actual==expected}))"
    counts=package_python(code)
    if not counts['allRowCountsMatch']:raise RuntimeError('Restored row counts differ')
    code="import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;from app_connections import configure;a=Admin();print(json.dumps(configure(a,"+repr(args.probe_database)+","+repr(args.probe_database)+",'172.30.77.0/24','172.30.77.1')))"
    allowed=package_python(code)
    if allowed['restartRequired']:raise RuntimeError('Private acceptance listener must already exist')
    code="import sys,json;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;a=Admin();print(a.sql(\"SELECT row_to_json(c) FROM (SELECT u.id AS sub,u.token_version AS ver,s.authentication_method AS amr,s.id AS sid FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.active AND u.is_superuser AND s.revoked_at IS NULL AND s.expires_at>now() AND s.token_version=u.token_version ORDER BY s.id DESC LIMIT 1)c\","+repr(args.probe_database)+"))"
    claims=package_python(code)
    if not isinstance(claims,dict):raise ValueError('No valid copied admin session is available for isolated acceptance')
    app=stage/'app';app.mkdir()
    source_data=next(m['Source'] for m in source['Mounts'] if m['Destination']=='/data')
    subprocess.run(['cp','-a',source_data+'/.',str(app)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=300)
    config,env=probe_config(source,credentials,app)
    uid,gid=int(env['PUID']),int(env['PGID'])
    for parent,dirs,files in os.walk(str(app),followlinks=False):
        os.chown(parent,uid,gid,follow_symlinks=False)
        for name in dirs+files:os.chown(os.path.join(parent,name),uid,gid,follow_symlinks=False)
    app.chmod(0o700)
    # Release the preceding session's explicitly labelled test client only.
    previous=docker('GET','/containers/bookorbit-nativepg-acceptance/json')
    if previous['Config'].get('Labels',{}).get('bookorbit.acceptance')=='native-pg' and previous['State']['Status']=='running':
        docker('POST','/containers/bookorbit-nativepg-acceptance/stop?t=30')
    name='bookorbit-nativepg-preflight'
    docker('POST','/containers/create?name='+name,config);docker('POST','/containers/'+name+'/start')
    try:
        deadline=time.monotonic()+300;address=None
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while time.monotonic()<deadline:
            info=docker('GET','/containers/'+name+'/json')
            if info['State']['Status']=='exited':raise RuntimeError('Preflight client exited')
            ip=info['NetworkSettings']['Networks']['bookorbit-nativepg-acceptance']['IPAddress']
            if ip:
                address='http://'+ip+':'+env.get('PORT','3000')
                try:
                    with opener.open(address+'/api/v1/health',timeout=3) as response:
                        if response.status==200:break
                except (OSError,urllib.error.URLError):pass
            time.sleep(3)
        else:raise TimeoutError('Preflight client did not become healthy')
        functional=functional_probe(address,env['JWT_SECRET'],claims)
        unchanged=docker('GET','/containers/bookorbit-app/json')['Id']==source['Id'] and all(hashlib.sha256((root/n).read_bytes()).hexdigest()==h for n,h in before.items())
        if not unchanged:raise RuntimeError('Production changed during preparation; repeat preflight')
        report={'passed':True,'sourceImageId':source['Image'],'sourceContainerId':source['Id'],'consistentBackup':str(backup),'restore':counts,'application':functional,'productionUnchanged':True,'productionDatabaseCutover':False,'configurationHashes':before,'probeDatabase':args.probe_database}
        private_json(stage/'acceptance.json',report);print(json.dumps(report),flush=True)
    finally:docker('POST','/containers/'+name+'/stop?t=30')

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as error:
        print('Native PG migration preparation failed: '+type(error).__name__,file=sys.stderr);raise SystemExit(1)
