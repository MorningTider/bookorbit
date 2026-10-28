#!/usr/bin/env python3
"""Read-only API acceptance of the isolated installed package; no tokens leave the NAS."""
import argparse
import base64
import concurrent.futures
import hashlib
import hmac
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.request
import urllib.error
import urllib.parse


def probe(output, production=False):
    if os.geteuid()!=0:raise ValueError('Local package configuration access requires administrator execution')
    root=pathlib.Path('/var/packages/bookorbit-native/target').resolve(strict=True)
    state=pathlib.Path('/volume1/@appdata/bookorbit-native')
    config=json.loads((state/'service.json').read_text())
    assert config['mode']==('production' if production else 'isolated')
    if production:assert config['port']==8184
    database=urllib.parse.urlsplit(config['environment']['DATABASE_URL']).path.lstrip('/')
    assert re.fullmatch(r'bookorbit_prod_spk_[0-9]+' if production else r'bookorbit_spk_pathcheck_[a-z0-9_]+',database)
    query="SELECT row_to_json(c) FROM (SELECT u.id AS sub,u.token_version AS ver,s.authentication_method AS amr,s.id AS sid FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.active AND u.is_superuser AND s.revoked_at IS NULL AND s.expires_at>now() AND s.token_version=u.token_version ORDER BY s.id DESC LIMIT 1)c"
    code="import sys;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;print(Admin().sql("+repr(query)+","+repr(database)+"))"
    result=subprocess.run(['sudo','-u','postgresql18','python3','-'],input=code,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
    if result.returncode:raise RuntimeError('Could not read isolated session claims')
    claims=json.loads(result.stdout);claims.update({'iat':int(time.time()),'exp':int(time.time())+300})
    def encode(value):return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=')
    message=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode(claims)
    token=(message+b'.'+base64.urlsafe_b64encode(hmac.new(config['environment']['JWT_SECRET'].encode(),message,hashlib.sha256).digest()).rstrip(b'=')).decode()
    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
    base='http://127.0.0.1:'+str(config['port'])+'/api/v1'
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(path,body=None,extra=None):
        req=urllib.request.Request(base+path,headers={**headers,**(extra or {})},data=json.dumps(body).encode() if body is not None else None)
        with opener.open(req,timeout=30) as response:return response.status,response.read(),{key.lower():value for key,value in response.headers.items()}
    status,body,_=request('/health');checks={'databaseHealthy':status==200 and json.loads(body)['status']=='ok'}
    status,body,_=request('/books/query',{'pagination':{'page':0,'size':5}});query=json.loads(body)
    checks['copiedBooksQueryable']=status in (200,201) and query['total']==11
    assert query['items'],'No representative book'
    book=int(query['items'][0]['id']);status,body,_=request('/books/'+str(book));detail=json.loads(body)
    checks['bookDetail']=status==200 and bool(detail['files'])
    status,body,_=request('/book-sources/status');sources=json.loads(body)
    checks['bundledDownloaderConfigured']=status==200 and sources.get('fanqie',{}).get('configured') is True
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        checks['fourParallelDetails']=list(pool.map(lambda _:request('/books/'+str(book))[0],range(4)))==[200]*4
    file=next(f for f in detail['files'] if f.get('format') not in ['mp3','m4a','m4b','flac','ogg','opus','wav'])
    path=pathlib.Path(file['absolutePath']);assert str(path).startswith('/volume1/library/')
    with path.open('rb') as stream:expected=stream.read(4096)
    status,content,received=request('/books/files/'+str(int(file['id']))+'/serve',extra={'Range':'bytes=0-4095'})
    checks['nativeHostPathAndRange']=status==206 and content==expected and received.get('content-range','').startswith('bytes 0-')
    with opener.open(base.rsplit('/api/v1',1)[0]+'/',timeout=15) as response:checks['frontendServed']=response.status==200 and b'<html' in response.read().lower()
    try:opener.open(base+'/libraries',timeout=10);checks['anonymousRejected']=False
    except urllib.error.HTTPError as error:checks['anonymousRejected']=error.code==401
    pid_record=json.loads((state/'service.pid.json').read_text())
    matched=[]
    for process in pathlib.Path('/proc').iterdir():
        if not process.name.isdigit():continue
        try:
            fields=(process/'stat').read_text().rsplit(')',1)[1].split()
            if int(fields[1])==pid_record['pid'] and (process/'exe').resolve(strict=True)==root/'bin/node':matched.append(process.stat().st_uid)
        except OSError:continue
    checks['dedicatedNativeProcess']=matched==[217211]
    with urllib.request.urlopen('http://127.0.0.1:8184/api/v1/health',timeout=10) as response:checks['productionStillHealthy']=response.status==200 and json.load(response)['status']=='ok'
    if production:
        source=json.loads(subprocess.check_output(['docker','inspect','bookorbit-app']))[0]
        checks['oldContainerStopped']=source['State']['Running'] is False
        checks['oldContainerRestartDisabled']=source['HostConfig']['RestartPolicy']['Name']=='no'
    report={'kind':'installed-native-production-api' if production else 'installed-native-isolated-api','database':database,'packageVersion':json.loads((root/'acceptance-build.json').read_text())['packageVersion'],'checks':checks,'passed':all(checks.values()),'bookTotal':query['total'],'tokensTransferred':False,'readOnlyApiRequests':True}
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as target:json.dump(report,target,indent=2)
    print(json.dumps(report))
    if not report['passed']:raise RuntimeError('Installed native application acceptance failed')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--production',action='store_true');args=parser.parse_args();probe(args.output,args.production)
