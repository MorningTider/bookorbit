#!/usr/bin/env python3
"""Collect version-bound notice files and reject any content hash change."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import urllib.request


def collect(lock,output):
    lock=json.loads(pathlib.Path(lock).read_text());output=pathlib.Path(output)
    if lock.get('schemaVersion')!=1 or not lock.get('notices'):raise ValueError('A notice lock is required')
    output.mkdir();rows=[]
    for item in lock['notices']:
        if not re.fullmatch(r'[a-zA-Z0-9@/._-]+',item['component']) or not re.fullmatch(r'[a-f0-9]{40}',item['commit']):raise ValueError('Invalid notice identity')
        if item.get('source')=='repository LICENSE':
            data=subprocess.check_output(['git','show',item['commit']+':LICENSE'],cwd=pathlib.Path(__file__).resolve().parents[3],timeout=20)
        else:
            url=item['url']
            if not url.startswith('https://raw.githubusercontent.com/') or '/'+item['commit']+'/' not in url:raise ValueError('A commit-pinned upstream notice is required')
            with urllib.request.urlopen(url,timeout=25) as response:data=response.read(2*1024*1024+1)
        if len(data)>2*1024*1024 or hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Notice content differs from reviewed lock')
        name=item['component'].replace('/','_')+'.txt';(output/name).write_bytes(data)
        rows.append({'component':item['component'],'file':name,'sha256':item['sha256'],'commit':item['commit'],'evidenceKind':item['evidenceKind']})
    (output/'receipt.json').write_text(json.dumps({'schemaVersion':1,'notices':rows,'allHashesVerified':True,'releaseApproved':False},indent=2)+'\n')
    print(json.dumps({'notices':len(rows),'allHashesVerified':True,'releaseApproved':False}))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--lock',required=True);p.add_argument('--output',required=True);a=p.parse_args();collect(a.lock,a.output)
