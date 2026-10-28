#!/usr/bin/env python3
"""Add the already-pinned optional downloader to a fresh, inventoried candidate."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import shutil
import tempfile


def digest(path):
    result=hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda:source.read(1048576),b''):result.update(chunk)
    return result.hexdigest()


def validate(binary,lock):
    binary=pathlib.Path(binary)
    if binary.is_symlink() or not binary.is_file() or binary.stat().st_size!=lock['bytes'] or digest(binary)!=lock['sha256']:
        raise ValueError('Auxiliary release identity differs from lock')
    with binary.open('rb') as source:header=source.read(20)
    if header[:6]!=b'\x7fELF\x02\x01' or header[18:20]!=b'\x3e\x00':raise ValueError('Auxiliary runtime must be Linux x86_64 ELF')


def attach(stage,binary,output):
    here=pathlib.Path(__file__).resolve().parent;repo=here.parents[2]
    lock=json.loads((here/'runtime-source-lock.json').read_text())['auxiliary']['tomato']
    validate(binary,lock)
    stage=pathlib.Path(stage).resolve(strict=True);output=pathlib.Path(output).absolute()
    if output.exists():raise ValueError('Auxiliary candidate output must be new')
    spec=importlib.util.spec_from_file_location('contract',here/'payload-contract.py');contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)
    receipt=json.loads(stage.with_name(stage.name+'.inventory.json').read_text())
    if receipt.get('status')!='support-candidate-not-release' or contract.inventory(stage)!=receipt.get('files'):raise ValueError('Existing source/support inventory differs')
    for name,sha in lock['licenses'].items():
        if digest(repo/name)!=sha:raise ValueError('Auxiliary license input differs')
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.bookorbit-aux-',dir=output.parent) as temp:
        root=pathlib.Path(temp)/'candidate';shutil.copytree(stage,root,symlinks=True)
        target=root/'bin/tomato-downloader'
        if target.exists():raise ValueError('Auxiliary destination is already populated')
        shutil.copyfile(binary,target);target.chmod(0o755)
        for name in lock['licenses']:
            destination=root/name
            if destination.exists():raise ValueError('Auxiliary license destination already exists')
            destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(repo/name,destination)
        (root/'provenance/auxiliary-runtime.json').write_text(json.dumps(lock,indent=2)+'\n')
        receipt['files']=contract.inventory(root)
        receipt['auxiliary']={'tomato':{'version':lock['version'],'sha256':lock['sha256']}}
        result=output.with_name(output.name+'.inventory.json')
        with result.open('x') as stream:json.dump(receipt,stream,indent=2)
        try:root.rename(output)
        except BaseException:result.unlink();raise
    print(json.dumps({'output':str(output),'files':len(receipt['files']),'auxiliary':receipt['auxiliary']}))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--stage',required=True);p.add_argument('--binary',required=True);p.add_argument('--output',required=True);a=p.parse_args();attach(a.stage,a.binary,a.output)
