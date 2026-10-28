#!/usr/bin/env python3
"""Inventory release evidence gaps; never infer legal clearance from metadata."""
import argparse
import collections
import json
import pathlib
import re


def audit(root):
    root=pathlib.Path(root).resolve(strict=True)
    packages=[]
    for path in sorted((root/'app/node_modules/.pnpm').glob('*/node_modules/*/package.json'))+sorted((root/'app/node_modules/.pnpm').glob('*/node_modules/@*/*/package.json')):
        if path.is_symlink() or not path.resolve().is_relative_to(root):continue
        value=json.loads(path.read_text())
        if not value.get('name') or not value.get('version'):continue
        licenses=[p.relative_to(root).as_posix() for p in path.parent.iterdir() if p.is_file() and re.match(r'^(licen[cs]e|copying|notice)([.\-_]|$)',p.name,re.I)]
        packages.append({'name':value['name'],'version':value['version'],'declaredLicense':value.get('license'),'packageJson':path.relative_to(root).as_posix(),'localNoticeFiles':sorted(licenses),'metadataOnlyNotLegallyCleared':True})
    return {'schemaVersion':1,'kind':'release-evidence-gap-inventory','releaseApproved':False,'npmPackageInstances':len(packages),'missingDeclaredLicense':sum(not p['declaredLicense'] for p in packages),'missingLocalNotice':sum(not p['localNoticeFiles'] for p in packages),'declaredLicenseCounts':dict(collections.Counter(str(p['declaredLicense']) for p in packages)),'packages':packages,'remaining':['Review component license text and corresponding source obligations','Bind every payload file to reviewed component evidence','Run payload-contract validation before public release']}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--payload',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    report=audit(a.payload)
    with pathlib.Path(a.output).open('x') as f:json.dump(report,f,indent=2,ensure_ascii=False)
    print(json.dumps({k:v for k,v in report.items() if k!='packages'}))
