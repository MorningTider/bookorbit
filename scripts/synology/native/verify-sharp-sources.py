#!/usr/bin/env python3
"""Check collected archives against upstream checksums or immutable Git trees."""
import argparse
import base64
import concurrent.futures
import hashlib
import fnmatch
import json
import pathlib
import re
import subprocess
import tarfile
import time
import urllib.parse
import urllib.request


def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def github(endpoint):
    result=subprocess.run(['gh','api',endpoint],capture_output=True,timeout=40)
    if result.returncode:raise ValueError('Upstream GitHub metadata request failed')
    if len(result.stdout)>16*1024*1024:raise ValueError('Upstream metadata limit exceeded')
    return json.loads(result.stdout)


def match_checksum(text, filename, expected):
    rows=[]
    for line in text.splitlines():
        match=re.fullmatch(r'([a-fA-F0-9]{64}|[a-fA-F0-9]{128})\s+\*?([^\s]+)',line.strip())
        if match and match[2]==filename:rows.append(match[1].lower())
    if len(rows)!=1 or rows[0]!=expected:raise ValueError('Upstream checksum missing, ambiguous or different')


def crlf_export_allowed(name,attributes,blobs):
    if not attributes:return False
    parents=pathlib.PurePosixPath(name).parents
    if any(str(parent) not in ('.','') and (str(parent)+'/.gitattributes') in blobs for parent in parents):return False
    text=False;eol=None
    for line in attributes.splitlines():
        parts=line.strip().split()
        if not parts or parts[0].startswith('#'):continue
        pattern=parts[0];target=name if '/' in pattern else name.rsplit('/',1)[-1]
        if not fnmatch.fnmatchcase(target,pattern):continue
        for item in parts[1:]:
            if item in ('-text','!text','binary'):text=False
            elif item=='text':text=True
            elif item=='text=auto':text=False
            elif item.startswith('eol='):eol=item[4:]
    return text and eol=='crlf'


def verify_tree(path, tree):
    if tree.get('truncated') or not isinstance(tree.get('tree'),list):raise ValueError('Complete upstream tree required')
    blobs={x['path']:x for x in tree['tree'] if x['type']=='blob'}
    matched=set();root=None;total=0;attributes=None;transforms=[]
    with tarfile.open(path,mode='r|*') as archive:
        for index,member in enumerate(archive):
            if index>=100000:raise ValueError('Archive member limit exceeded')
            parts=pathlib.PurePosixPath(member.name).parts
            if not parts or member.name.startswith('/') or '..' in parts:raise ValueError('Unsafe archive path')
            if root is None:root=parts[0]
            if parts[0]!=root:raise ValueError('Archive has multiple roots')
            if member.isdir():continue
            name='/'.join(parts[1:]);entry=blobs.get(name)
            if not entry or name in matched:raise ValueError('Archive entry absent or duplicated in upstream tree')
            if member.issym():
                if entry['mode']!='120000':raise ValueError('Archive link type differs from Git')
                data=member.linkname.encode();digest=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
            elif member.isfile():
                if entry['mode'] not in ('100644','100755'):raise ValueError('Archive file type differs from Git')
                if bool(member.mode&0o111)!=(entry['mode']=='100755'):raise ValueError('Archive executable mode differs from Git')
                total+=member.size
                if member.size>128*1024*1024 or total>2*1024*1024*1024:raise ValueError('Expanded source limit exceeded')
                retain=name=='.gitattributes' or crlf_export_allowed(name,attributes,blobs)
                content=bytearray() if retain else None
                h=hashlib.sha1(b'blob '+str(member.size).encode()+b'\0');stream=archive.extractfile(member)
                for block in iter(lambda:stream.read(65536),b''):
                    h.update(block)
                    if content is not None:content.extend(block)
                digest=h.hexdigest()
                if digest!=entry['sha'] and name!='.gitattributes' and content is not None:
                    normalized=bytes(content).replace(b'\r\n',b'\n')
                    converted=hashlib.sha1(b'blob '+str(len(normalized)).encode()+b'\0'+normalized).hexdigest()
                    if converted==entry['sha'] and bytes(content)==normalized.replace(b'\n',b'\r\n'):
                        digest=converted;transforms.append({'path':name,'transform':'root-gitattributes-crlf-export','archiveSha256':hashlib.sha256(content).hexdigest()})
                if name=='.gitattributes' and digest==entry['sha']:
                    if len(content)>65536:raise ValueError('Source attributes too large')
                    attributes=content.decode('utf-8')
            else:raise ValueError('Unsupported archive entry type')
            if digest!=entry['sha']:raise ValueError('Archive content differs from upstream Git blob')
            matched.add(name)
    if not matched:raise ValueError('Empty source archive')
    missing=sorted(set(blobs)-matched)
    return {'gitBlobsMatched':len(matched),'gitBlobsOmitted':len(missing),'omittedPaths':missing,'exportTransformations':transforms,
            'sourceCompletenessApproved':False}


def upstream_bytes(url, limit=16*1024*1024):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BookOrbit-source-evidence'}),timeout=25) as response:
        data=response.read(limit+1);following=response.headers.get('X-Next-Page','')
    if len(data)>limit:raise ValueError('Upstream response too large')
    return data,following


def gitlab_tree(host,repo,ref):
    base='https://'+host+'/api/v4/projects/'+urllib.parse.quote(repo,safe='')+'/repository/'
    raw,_=upstream_bytes(base+'commits/'+urllib.parse.quote(ref,safe=''));commit=json.loads(raw);identity=commit['id']
    if not re.fullmatch(r'[a-f0-9]{40}',identity):raise ValueError('Invalid upstream commit')
    entries=[];page='1';deadline=time.monotonic()+150
    for _ in range(100):
        if time.monotonic()>deadline:raise ValueError('GitLab tree time limit exceeded')
        data,following=upstream_bytes(base+'tree?recursive=true&per_page=100&page='+page+'&ref='+identity)
        batch=json.loads(data)
        if not isinstance(batch,list):raise ValueError('Invalid upstream tree page')
        entries.extend(dict(x,sha=x['id']) for x in batch)
        if not following:return commit,{'tree':entries,'truncated':False}
        if not following.isdigit() or int(following)<=int(page):raise ValueError('Invalid tree pagination')
        page=following
    raise ValueError('Upstream tree page limit exceeded')


def match_object_metadata(path,metadata):
    h=hashlib.md5()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    if str(path.stat().st_size)!=metadata.get('size') or base64.b64encode(h.digest()).decode()!=metadata.get('md5Hash'):
        raise ValueError('Official object metadata differs')
    return {'officialObjectMd5Corroborated':True,'weakChecksumAlgorithm':'MD5',
            'strongIndependentChecksumVerified':False,'objectGeneration':metadata['generation']}


def verify_one(row, base, output):
    result={'name':row['name'],'sourceUrl':row['url'],'archiveSha256':row['sha256'],
            'upstreamIdentityVerified':False,'independentArchiveChecksumVerified':False}
    try:
        name=row['path']
        if not re.fullmatch(r'[a-z0-9-]+\.source',name):raise ValueError('Unsafe source archive identity')
        path=base/name
        if path.is_symlink() or sha256(path)!=row['sha256']:raise ValueError('Collected archive integrity differs')
        url=row['url']
        release=re.fullmatch(r'https://github.com/([\w.-]+/[\w.-]+)/releases/download/([^/]+)/([^/]+)',url)
        source=re.fullmatch(r'https://github.com/([\w.-]+/[\w.-]+)/archive/([^/]+)\.tar\.gz',url)
        if release:
            repo,tag,asset=release.groups();endpoint='repos/'+repo+'/releases/tags/'+urllib.parse.quote(tag,safe='')
            metadata=github(endpoint);found=[x for x in metadata['assets'] if x['name']==asset]
            (output/(row['name']+'.upstream.json')).write_text(json.dumps(metadata,indent=2)+'\n')
            if len(found)!=1 or found[0].get('digest')!='sha256:'+row['sha256']:raise ValueError('Upstream asset digest unavailable or different')
            result.update(upstreamIdentityVerified=True,independentArchiveChecksumVerified=True,
                          method='github-release-asset-sha256',assetId=found[0]['id'],metadataEndpoint=endpoint)
        elif source:
            repo,ref=source.groups();commit=github('repos/'+repo+'/commits/'+urllib.parse.quote(ref,safe=''))
            identity=commit['sha']
            if not re.fullmatch(r'[a-f0-9]{40}',identity):raise ValueError('Invalid upstream commit')
            tree=github('repos/'+repo+'/git/trees/'+commit['commit']['tree']['sha']+'?recursive=1')
            (output/(row['name']+'.upstream.json')).write_text(json.dumps({'commit':commit,'tree':tree},indent=2)+'\n')
            result.update(verify_tree(path,tree));result.update(upstreamIdentityVerified=True,method='github-commit-git-blob-match',commit=identity)
        elif re.fullmatch(r'https://(?:gitlab.com|gitlab.freedesktop.org)/.+/-/archive/[^/]+/[^/]+',url):
            parsed=urllib.parse.urlsplit(url);repo,tail=parsed.path.strip('/').split('/-/archive/');ref=tail.split('/')[0]
            commit,tree=gitlab_tree(parsed.hostname,repo,ref)
            (output/(row['name']+'.upstream.json')).write_text(json.dumps({'commit':commit,'tree':tree},indent=2)+'\n')
            result.update(verify_tree(path,tree));result.update(upstreamIdentityVerified=True,method='gitlab-commit-git-blob-match',commit=commit['id'])
        elif url.startswith('https://cairographics.org/releases/'):
            suffix='.sha512' if row['name']=='pixman' else '.sha256sum';checksum_url=url+suffix
            data,_=upstream_bytes(checksum_url,1024*1024);(output/(row['name']+suffix)).write_bytes(data)
            expected=row['sha256']
            if suffix=='.sha512':
                h=hashlib.sha512()
                with path.open('rb') as f:
                    for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
                expected=h.hexdigest()
            match_checksum(data.decode(),url.rsplit('/',1)[1],expected)
            result.update(upstreamIdentityVerified=True,independentArchiveChecksumVerified=True,method='upstream-'+('sha512' if suffix=='.sha512' else 'sha256')+'-file',checksumUrl=checksum_url)
        elif url.startswith('https://storage.googleapis.com/'):
            bucket,key=urllib.parse.urlsplit(url).path.strip('/').split('/',1)
            if bucket not in ('aom-releases','downloads.webmproject.org'):raise ValueError('Unsupported source bucket')
            endpoint='https://storage.googleapis.com/storage/v1/b/'+bucket+'/o/'+urllib.parse.quote(key,safe='')
            data,_=upstream_bytes(endpoint);metadata=json.loads(data)
            (output/(row['name']+'.upstream.json')).write_bytes(data)
            result.update(match_object_metadata(path,metadata));result.update(upstreamIdentityVerified=True,method='official-object-metadata-md5',metadataUrl=endpoint)
        elif url.startswith('https://download.gnome.org/sources/'):
            checksum_url=re.sub(r'\.tar\.(?:xz|gz|bz2)$','.sha256sum',url)
            if checksum_url==url:raise ValueError('Unsupported GNOME source URL')
            with urllib.request.urlopen(checksum_url,timeout=25) as response:data=response.read(1024*1024+1)
            if len(data)>1024*1024:raise ValueError('Checksum response too large')
            (output/(row['name']+'.sha256sum')).write_bytes(data)
            match_checksum(data.decode(),url.rsplit('/',1)[1],row['sha256'])
            result.update(upstreamIdentityVerified=True,independentArchiveChecksumVerified=True,method='upstream-sha256-file',checksumUrl=checksum_url)
        else:result['pending']='No supported independent upstream verification method'
    except Exception as error:
        result.update(errorClass=type(error).__name__,pending=str(error)[:180] if isinstance(error,ValueError) else 'Upstream verification failed')
    return result


def validate_lock(report,lock):
    if lock.get('schemaVersion')!=1 or report.get('recipeSha256')!=lock.get('recipeSha256') or report.get('versionsSha256')!=lock.get('versionsSha256'):
        raise ValueError('Acquisition recipe or installed versions differ from reviewed lock')
    expected={x['name']:(x['url'],x['sha256']) for x in lock['sourceArchives']}
    actual={x['name']:(x['url'],x['sha256']) for x in report['archives']}
    if not expected or len(expected)!=len(lock['sourceArchives']) or len(actual)!=len(report['archives']) or expected!=actual:
        raise ValueError('Source acquisition differs from reviewed lock')


def verify(receipt,output,lock_path=None):
    receipt=pathlib.Path(receipt).resolve(strict=True);report=json.loads(receipt.read_text())
    if report.get('kind')!='sharp-source-acquisition' or not report.get('allArchivesCollected'):raise ValueError('Completed acquisition receipt required')
    lock_path=pathlib.Path(lock_path) if lock_path else pathlib.Path(__file__).with_name('sharp-source-evidence-lock.json')
    lock=json.loads(lock_path.read_text());validate_lock(report,lock)
    rows=report['archives']
    if len({x['name'] for x in rows})!=len(rows) or any(not re.fullmatch(r'[a-z0-9-]+',x['name']) for x in rows):raise ValueError('Invalid component names')
    output=pathlib.Path(output);output.mkdir()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results=list(pool.map(lambda row:verify_one(row,receipt.parent,output),rows))
    expected={x['name']:x for x in lock['sourceArchives']}
    for row in results:
        for field in ('commit','assetId','objectGeneration'):
            if field in expected[row['name']] and row.get(field)!=expected[row['name']][field]:
                row.update(upstreamIdentityVerified=False,independentArchiveChecksumVerified=False,pending='Upstream identity differs from reviewed lock')
    summary={'kind':'sharp-upstream-source-verification','acquisitionReceiptSha256':sha256(receipt),'sourceEvidenceLockSha256':sha256(lock_path),
             'sources':len(results),'upstreamIdentityVerified':sum(x['upstreamIdentityVerified'] for x in results),
             'independentChecksumsVerified':sum(x['independentArchiveChecksumVerified'] for x in results),
             'weakObjectMetadataCorroborated':sum(x.get('officialObjectMd5Corroborated',False) for x in results),
             'archives':results,'releaseApproved':False,
             'remaining':['Review patches, omitted files and recursive build dependencies','Bind source and license evidence to all installed payload components']}
    (output/'receipt.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='archives'}))
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--receipt',required=True);p.add_argument('--output',required=True);p.add_argument('--lock');a=p.parse_args();result=verify(a.receipt,a.output,a.lock);raise SystemExit(0 if result['upstreamIdentityVerified']==result['sources'] else 1)
