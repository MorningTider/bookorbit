#!/usr/bin/env python3
"""Collect source evidence from a pinned sharp recipe without executing it."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import re
import tarfile
import time
import urllib.request


def source_plan(recipe,versions):
    values={key.upper().replace('-','_'):value for key,value in versions.items()}
    result=[]
    for line in recipe.splitlines():
        match=re.search(r'\$CURL (https://\S.*?) \| tar .*?\$\{DEPS\}/([a-z0-9-]+)',line)
        if not match:continue
        url,name=match.groups()
        url=re.sub(r'\$\(without_patch \$VERSION_([A-Z0-9_]+)\)',lambda m:values[m[1]].rsplit('.',1)[0],url)
        url=re.sub(r'\$\(without_prerelease \$VERSION_([A-Z0-9_]+)\)',lambda m:values[m[1]].split('-',1)[0],url)
        url=re.sub(r'\$\{VERSION_([A-Z0-9_]+)//\./([-_])\}',lambda m:values[m[1]].replace('.',m[2]),url)
        url=re.sub(r'\$\{VERSION_([A-Z0-9_]+)\}',lambda m:values[m[1]],url)
        if '$' in url or not re.fullmatch(r'https://[^\s]+',url):raise ValueError('Unresolved source URL')
        if any(x['name']==name for x in result):raise ValueError('Duplicate source target')
        result.append({'name':name,'url':url})
    if len(result)!=len(versions):raise ValueError('Source recipe does not cover the installed version inventory')
    return result


def collect(recipe,versions,output):
    output=pathlib.Path(output);output.mkdir()
    plan=source_plan(pathlib.Path(recipe).read_text(),json.loads(pathlib.Path(versions).read_text()))
    def fetch(item):
        url=item['url'];alternate=re.fullmatch(r'https://github.com/([^/]+/[^/]+)/archive/(.+)\.tar\.gz',url)
        download='https://codeload.github.com/'+alternate[1]+'/tar.gz/'+alternate[2] if alternate else url
        path=output/(item['name']+'.source');temporary=path.with_suffix('.partial');started=time.monotonic();digest=hashlib.sha256();size=0
        try:
            with urllib.request.urlopen(urllib.request.Request(download,headers={'User-Agent':'BookOrbit-source-evidence'}),timeout=20) as source,temporary.open('xb') as target:
                for block in iter(lambda:source.read(65536),b''):
                    size+=len(block)
                    if size>160*1024*1024 or time.monotonic()-started>150:raise ValueError('Source download limit reached')
                    target.write(block);digest.update(block)
            if not tarfile.is_tarfile(temporary):raise ValueError('Source response is not a tar archive')
            temporary.replace(path)
            return {**item,'downloadUrl':download,'path':path.name,'bytes':size,'sha256':digest.hexdigest(),'collected':True,'independentChecksumVerified':False}
        except Exception as error:
            temporary.unlink(missing_ok=True)
            return {**item,'downloadUrl':download,'collected':False,'error':type(error).__name__}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows=list(pool.map(fetch,plan))
    receipt={'schemaVersion':1,'kind':'sharp-source-acquisition','recipeSha256':hashlib.sha256(pathlib.Path(recipe).read_bytes()).hexdigest(),'versionsSha256':hashlib.sha256(pathlib.Path(versions).read_bytes()).hexdigest(),'archives':rows,'allArchivesCollected':all(x['collected'] for x in rows),'releaseApproved':False,'remaining':['Verify upstream archive checksums and patch identities','Include corresponding build instructions and library notices','Review all source and license obligations']}
    (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'sources':len(rows),'collected':sum(x['collected'] for x in rows),'failed':[x['name'] for x in rows if not x['collected']],'releaseApproved':False}))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--recipe',required=True);p.add_argument('--versions',required=True);p.add_argument('--output',required=True);a=p.parse_args();collect(a.recipe,a.versions,a.output)
