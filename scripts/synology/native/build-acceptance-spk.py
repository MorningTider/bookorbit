#!/usr/bin/env python3
"""Assemble DSM candidates or evidence-bound self-use stable packages."""
import argparse
import gzip
import hashlib
import importlib.util
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile


def digest(path):
    result=hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()


def migration_digest(root):
    result=hashlib.sha256()
    files=sorted((root/'app/migrations').rglob('*'))
    if not files:raise ValueError('Migration input is missing')
    for path in files:
        if path.is_file():result.update(path.relative_to(root).as_posix().encode()+b'\0'+bytes.fromhex(digest(path)))
    return result.hexdigest()


def member(tar,path,name,mode=None):
    item=tar.gettarinfo(str(path),arcname=name)
    item.uid=item.gid=0;item.uname=item.gname='root';item.mtime=0
    if mode is not None:item.mode=mode
    item.mode=0o755 if path.is_dir() or path.stat().st_mode&0o111 else 0o644
    if item.isfile():
        with pathlib.Path(path).open('rb') as stream:tar.addfile(item,stream)
    else:tar.addfile(item)


def production_acceptance(path):
    value=json.loads(pathlib.Path(path).read_text())
    required={'databaseHealthy','copiedBooksQueryable','bookDetail','bundledDownloaderConfigured','fourParallelDetails','nativeHostPathAndRange','frontendServed','anonymousRejected','dedicatedNativeProcess','productionStillHealthy'}
    if (value.get('kind')!='installed-native-isolated-api' or value.get('passed') is not True
        or value.get('packageVersion')!='3.5.0-10001' or value.get('tokensTransferred') is not False
        or value.get('readOnlyApiRequests') is not True
        or any(value.get('checks',{}).get(name) is not True for name in required)):
        raise ValueError('Installed native upgrade acceptance is required for production capability')
    return digest(pathlib.Path(path))


def build(stage,report,output,revision=10000,production_report=None,private_stable_report=None,schema_upgrade_report=None):
    here=pathlib.Path(__file__).resolve().parent
    repo=here.parents[2]
    stage=pathlib.Path(stage).resolve(strict=True);output=pathlib.Path(output).absolute()
    if output.exists():raise ValueError('SPK output directory must be new')
    if not 10000<=revision<=19999:raise ValueError('Unsupported acceptance revision')
    if production_report and private_stable_report:raise ValueError('Select one production acceptance mode')
    subprocess.run(['git','diff-index','--quiet','HEAD','--'],cwd=repo,check=True)
    subprocess.run(['git','ls-files','--error-unmatch','scripts/synology/native/native-service.py'],cwd=repo,stdout=subprocess.PIPE,check=True)
    privilege=json.loads((here/'spk/conf/privilege').read_text())
    if privilege != {'defaults':{'run-as':'package'},'username':'bookorbit-native','groupname':'bookorbit-native'}:raise ValueError('A dedicated ordinary package identity is required')
    proof=json.loads(pathlib.Path(report).read_text())
    controller=here/'native-service.py'
    schema_policy=here/'schema-upgrade-policy.py'
    if proof.get('kind')!='synthetic-process-lifecycle' or proof.get('passed') is not True or proof.get('uid')==0 or proof.get('controllerSha256')!=digest(controller) or len(proof.get('checks',{}))<8 or not all(proof['checks'].values()):
        raise ValueError('Controller requires matching ordinary-account lifecycle acceptance')
    spec=importlib.util.spec_from_file_location('payload',here/'payload-contract.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    receipt=json.loads(stage.with_name(stage.name+'.inventory.json').read_text())
    if receipt.get('status')!='support-candidate-not-release' or module.inventory(stage)!=receipt.get('files'):
        raise ValueError('Source/support candidate inventory changed')
    source=json.loads((stage/'provenance/source-build.json').read_text())
    if not source.get('sharpNativeCheck'):raise ValueError('Verified source build required')
    for name in module.REQUIRED:
        if not (stage/name).is_file():raise ValueError('Missing application input')
    runtime_lock=json.loads((here/'runtime-source-lock.json').read_text())
    if digest(stage/'bin/node')!=runtime_lock['node']['binarySha256'] or digest(stage/'lib/libatomic.so.1')!=runtime_lock['libatomic']['binarySha256']:raise ValueError('Core runtime identity differs from lock')
    if (stage/'native-service.py').exists() or (stage/'acceptance-build.json').exists():raise ValueError('Reserved lifecycle destination already exists')
    metadata={'schemaVersion':1,'status':'isolated-dsm-install-acceptance-not-release','sourceCommit':source['sourceCommit'],'packageVersion':'3.5.0-'+str(revision),'payloadInventorySha256':digest(stage.with_name(stage.name+'.inventory.json')),'packagingCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'controllerSha256':digest(controller),'applicationMigrationSha256':migration_digest(stage),'productionEnabled':False,'pending':['dedicated account ACL','DSM lifecycle and upgrade','native PG full application','production backup and path cutover','complete redistribution audit']}
    metadata['schemaUpgradePolicySha256']=digest(schema_policy)
    if schema_upgrade_report:
        schema_spec=importlib.util.spec_from_file_location('schema_policy',schema_policy)
        policy=importlib.util.module_from_spec(schema_spec);schema_spec.loader.exec_module(policy)
        policy.validate_evidence(json.loads(pathlib.Path(schema_upgrade_report).read_text()),metadata)
        metadata['schemaUpgradeAcceptanceSha256']=digest(schema_upgrade_report)
    if production_report:
        metadata.update(status='private-production-migration-candidate-not-public-release',productionEnabled=True,installedUpgradeAcceptanceSha256=production_acceptance(production_report))
    stable_policy=None
    if private_stable_report:
        stable_spec=importlib.util.spec_from_file_location('private_stable_policy',here/'private-stable-policy.py')
        stable_policy=importlib.util.module_from_spec(stable_spec);stable_spec.loader.exec_module(stable_policy)
        proof_sha=stable_policy.validate(private_stable_report,metadata['sourceCommit'],metadata['payloadInventorySha256'],metadata['controllerSha256'],metadata['applicationMigrationSha256'],revision)
        stable_policy.apply_metadata(metadata,proof_sha)
    with tempfile.TemporaryDirectory(prefix='bookorbit-spk-') as directory:
        work=pathlib.Path(directory);outer=work/'outer';outer.mkdir()
        with (outer/'package.tgz').open('wb') as stream:
            with gzip.GzipFile(fileobj=stream,mode='wb',filename='',mtime=0) as zipped:
                with tarfile.open(fileobj=zipped,mode='w|',format=tarfile.PAX_FORMAT) as tar:
                    for path in sorted(stage.rglob('*')):member(tar,path,path.relative_to(stage).as_posix())
                    member(tar,controller,'native-service.py')
                    member(tar,schema_policy,'schema-upgrade-policy.py')
                    if schema_upgrade_report:member(tar,pathlib.Path(schema_upgrade_report),'schema-upgrade-acceptance.json',0o644)
                    data=(json.dumps(metadata,indent=2)+'\n').encode();entry=tarfile.TarInfo('acceptance-build.json');entry.size=len(data);entry.mode=0o644;entry.mtime=0;tar.addfile(entry,io.BytesIO(data))
        import shutil
        shutil.copytree(here/'spk/conf',outer/'conf');shutil.copytree(here/'spk/scripts',outer/'scripts')
        for path in (outer/'scripts').iterdir():path.chmod(0o755)
        version='3.5.0-'+str(revision)
        fields={'package':'bookorbit-native','version':version,'arch':'x86_64','os_min_ver':'7.4.1-90080','displayname':'BookOrbit 原生验收','maintainer':'MorningTider','description':'Private native installation acceptance. Isolated database only. Production mode disabled.','description_chs':'BookOrbit 原生安装验收候选，仅允许隔离数据库，尚未启用生产模式。','thirdparty':'yes','startable':'yes','precheckstartstop':'yes','install_dep_packages':'postgresql18>=18.6-10020','beta':'yes','checksum':hashlib.md5((outer/'package.tgz').read_bytes()).hexdigest()}
        if production_report:
            fields.update(displayname='BookOrbit',description='Private native production migration candidate. Requires explicit production configuration.',description_chs='BookOrbit 原生生产迁移候选，需显式生产配置。')
        if stable_policy:stable_policy.apply_info(fields)
        (outer/'INFO').write_text(''.join(key+'='+json.dumps(value,ensure_ascii=False)+'\n' for key,value in fields.items()))
        for name in ['PACKAGE_ICON.PNG','PACKAGE_ICON_256.PNG']:shutil.copyfile(repo/'docs/images/bookorbit-icon.png',outer/name)
        output.mkdir(parents=True)
        destination=output/('bookorbit-native_x86_64_'+version+'.spk')
        with tarfile.open(destination,'w',format=tarfile.PAX_FORMAT) as tar:
            for path in sorted(outer.rglob('*')):member(tar,path,path.relative_to(outer).as_posix())
    result={'path':str(destination),'sha256':digest(destination),'status':metadata['status'],'productionEnabled':metadata['productionEnabled']}
    (output/'acceptance-build.json').write_text(json.dumps({**metadata,**result},indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--stage',required=True);parser.add_argument('--lifecycle-report',required=True);parser.add_argument('--output',required=True);parser.add_argument('--revision',type=int,default=10000);parser.add_argument('--production-acceptance-report');parser.add_argument('--schema-upgrade-report');a=parser.parse_args();build(a.stage,a.lifecycle_report,a.output,a.revision,a.production_acceptance_report,schema_upgrade_report=a.schema_upgrade_report)
