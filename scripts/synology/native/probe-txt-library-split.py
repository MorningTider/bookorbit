#!/usr/bin/env python3
"""Exercise two scans and TXT reading; authentication stays inside the NAS."""
import argparse
import base64
import hashlib
import hmac
import importlib.util
import json
import os
import pathlib
import subprocess
import time
import urllib.parse
import urllib.request


def probe(state,root,audit,output,check_title):
    if os.geteuid()!=0:raise ValueError('NAS administrator execution required')
    state=pathlib.Path(state);root=pathlib.Path(root).resolve();audit=pathlib.Path(audit);output=pathlib.Path(output)
    if output.exists():raise ValueError('New result output required')
    config=json.loads((state/'service.json').read_text());db=urllib.parse.urlsplit(config['environment']['DATABASE_URL']).path.lstrip('/')
    if config['mode'] not in ('isolated','production') or not db.startswith(('bookorbit_spk_pathcheck_','bookorbit_prod_')):raise ValueError('Reviewed database required')
    def sql(query):
        code="import sys;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;print(Admin().sql("+repr(query)+","+repr(db)+"))"
        r=subprocess.run(['sudo','-u','postgresql18','/usr/bin/python3','-c',code],capture_output=True,text=True,timeout=40)
        if r.returncode:raise RuntimeError('Isolated database query failed')
        return r.stdout.strip()
    claims=json.loads(sql("SELECT row_to_json(x) FROM (SELECT u.id AS sub,u.token_version AS ver,s.authentication_method AS amr,s.id AS sid FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.active AND u.is_superuser AND s.revoked_at IS NULL AND s.expires_at>now() AND s.token_version=u.token_version ORDER BY s.id DESC LIMIT 1) x"))
    claims.update(iat=int(time.time()),exp=int(time.time())+900)
    def encode(x):return base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).rstrip(b'=')
    message=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode(claims)
    token=(message+b'.'+base64.urlsafe_b64encode(hmac.new(config['environment']['JWT_SECRET'].encode(),message,hashlib.sha256).digest()).rstrip(b'=')).decode()
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));base='http://127.0.0.1:'+str(config['port'])+'/api/v1'
    def request(path,body=None):
        r=urllib.request.Request(base+path,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=json.dumps(body).encode() if body is not None else None)
        with opener.open(r,timeout=60) as response:return json.load(response)
    def rows():return json.loads(sql("SELECT json_agg(x) FROM (SELECT b.id,b.primary_file_id,f.id AS file_id,f.absolute_path,m.title FROM books b JOIN book_files f ON f.book_id=b.id JOIN book_metadata m ON m.book_id=b.id WHERE b.library_id=1 ORDER BY f.id) x"))
    before=rows()
    if len(before)!=10 or len({x['id'] for x in before})!=10:raise ValueError('Expected ten independently catalogued TXT files')
    def hashes():
        result={}
        for row in before:
            path=pathlib.Path(row['absolute_path']);h=hashlib.sha256()
            with path.open('rb') as f:
                for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
            result[str(row['file_id'])]=h.hexdigest()
        return result
    original=hashes();jobs=[]
    for _ in range(2):
        job=request('/scanner/libraries/1/scan',{});job_id=job.get('jobId',job.get('id'))
        if type(job_id) is not int:raise ValueError('Expected scan job identity')
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            status=sql('SELECT status FROM scan_jobs WHERE id='+str(job_id))
            if status=='completed':break
            if status=='failed':raise RuntimeError('Isolated scan failed')
            time.sleep(1)
        else:raise RuntimeError('Scan did not complete')
        jobs.append(job_id)
        if rows()!=before:raise RuntimeError('Rescan changed book/file identity or title')
    for row in before:
        info=request('/epub/'+str(row['id'])+'/info?fileId='+str(row['file_id']))
        if not info.get('spine'):raise RuntimeError('TXT reader returned no readable sections')
    proof=json.loads((audit/'clone-result.json' if config['mode']=='isolated' else audit/'production-result.json').read_text())
    module=pathlib.Path(__file__).with_name('split-ebook-library.py')
    code="import importlib.util,json,sys;sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin;s=importlib.util.spec_from_file_location('repair',"+repr(str(module))+");m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.related(Admin(),"+repr(db)+","+repr(proof)+")))"
    r=subprocess.run(['sudo','-u','postgresql18','/usr/bin/python3','-c',code],capture_output=True,text=True,timeout=60)
    if r.returncode or json.loads(r.stdout)!=proof['protectedRecords']:raise RuntimeError('Reading records changed during scans or reader checks')
    checks={'libraryFileMode':sql('SELECT organization_mode FROM libraries WHERE id=1')=='book_per_file','individualTxtBooks':True,'rescanIdempotent':True,'originalFileIdsPreserved':True,'readingRecordsPreserved':True,'txtReaderWorks':True,'originalFilesUnchanged':hashes()==original}
    if check_title:
        paths=[x['absolute_path'] for x in before if x['file_id']==6461]
        js="const {TxtFormatExtractor}=require(process.argv[1]);new TxtFormatExtractor().extract(process.argv[2]).then(x=>console.log(JSON.stringify({title:x.title}))).catch(()=>process.exit(1))"
        r=subprocess.run(['sudo','-u','bookorbit-native','env','LD_LIBRARY_PATH='+str(root/'lib'),str(root/'bin/node'),'-e',js,str(root/'app/dist/modules/metadata/extractors/txt-format.extractor.js'),paths[0]],capture_output=True,text=True,timeout=30)
        checks['txtTitleHeaderFixed']=r.returncode==0 and json.loads(r.stdout)['title']=='云南虫谷'
    result={'kind':'txt-library-split-api','database':db,'uid':217211,'bookCount':10,'scanJobs':jobs,'checks':checks,'passed':all(checks.values()),'tokensTransferred':False,'productionWrites':config['mode']=='production'}
    output.write_text(json.dumps(result,indent=2)+'\n');output.chmod(0o600);print(json.dumps(result))
    if not result['passed']:raise RuntimeError('TXT organization acceptance failed')


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--state',required=True);p.add_argument('--root',required=True);p.add_argument('--audit',required=True);p.add_argument('--output',required=True);p.add_argument('--check-title',action='store_true');a=p.parse_args();probe(a.state,a.root,a.audit,a.output,a.check_title)
