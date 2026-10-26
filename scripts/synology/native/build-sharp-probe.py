#!/usr/bin/env python3
"""Build an isolated image-codec probe from locked JS deps and verified Linux addons."""
import argparse
import base64
import hashlib
import json
import pathlib
import shutil
import tarfile
import tempfile

p = argparse.ArgumentParser()
p.add_argument('--metadata', required=True)
p.add_argument('--cache', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
repo = pathlib.Path(__file__).resolve().parents[3]
cache = pathlib.Path(a.cache)
output = pathlib.Path(a.output)
assert not output.exists(), 'Do not overwrite an existing probe bundle'
root = pathlib.Path(tempfile.mkdtemp(prefix='bookorbit-sharp-probe-'))
manifest = []
try:
    queue = [pathlib.Path(repo / 'server/node_modules/sharp').resolve()]
    seen = set()
    while queue:
        package = queue.pop()
        metadata = json.loads((package / 'package.json').read_text())
        name = metadata['name']
        if name in seen:
            continue
        seen.add(name)
        if name == 'sharp':
            assert metadata['version'] == '0.35.5'
        target = root / 'node_modules' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(str(package), str(target), ignore=shutil.ignore_patterns('node_modules', 'test', 'tests'))
        manifest.append({'name': name, 'version': metadata['version']})
        for dependency in metadata.get('dependencies', {}):
            matches = [base / 'node_modules' / dependency for base in [package] + list(package.parents)]
            queue.append(next(candidate.resolve() for candidate in matches if candidate.is_dir()))
    expected = {'@img/sharp-linux-x64': '0.35.5', '@img/sharp-libvips-linux-x64': '1.3.4'}
    for metadata in json.loads(pathlib.Path(a.metadata).read_text()):
        name, version = metadata['name'], metadata['version']
        assert expected.pop(name) == version
        source = cache / (name.split('/')[-1] + '-' + version + '.tgz')
        blob = source.read_bytes()
        assert 'sha512-' + base64.b64encode(hashlib.sha512(blob).digest()).decode() == metadata['dist']['integrity']
        target = root / 'node_modules' / name
        target.mkdir(parents=True, exist_ok=True)
        with tarfile.open(str(source), 'r:gz') as bundle:
            for member in bundle.getmembers():
                relative = pathlib.PurePosixPath(member.name)
                assert relative.parts[0] == 'package' and '..' not in relative.parts
                destination = target.joinpath(*relative.parts[1:])
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    assert member.isfile(), 'Unexpected special file in the verified addon'
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.extractfile(member) as incoming, destination.open('wb') as outgoing:
                        shutil.copyfileobj(incoming, outgoing)
        manifest.append({'name': name, 'version': version, 'integrity': metadata['dist']['integrity']})
    assert not expected
    (root / 'probe.cjs').write_text("""const assert=require('node:assert/strict'),sharp=require('sharp');
(async()=>{const png=await sharp({create:{width:32,height:24,channels:4,background:{r:35,g:90,b:160,alpha:1}}}).png().toBuffer();assert.equal(png.subarray(1,4).toString(),'PNG');const a=await sharp(png).metadata();assert.equal(a.width,32);assert.equal(a.height,24);const jpeg=await sharp(png).resize(16,12).jpeg().toBuffer();const b=await sharp(jpeg).metadata();assert.equal(b.width,16);assert.equal(b.height,12);const webp=await sharp(png).rotate(90).webp().toBuffer();const c=await sharp(webp).metadata();assert.equal(c.width,24);assert.equal(c.height,32);console.log(JSON.stringify({sharp:sharp.versions.sharp,vips:sharp.versions.vips,png:true,jpegResize:true,webpRotate:true,passed:true}));})().catch(e=>{console.error(e.message);process.exitCode=1});
""")
    (root / 'probe-manifest.json').write_text(json.dumps(manifest, indent=2))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(str(output), 'w:gz') as bundle:
        for item in root.iterdir():
            bundle.add(str(item), arcname=item.name)
    print(json.dumps({'path': str(output), 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'packages': manifest}))
finally:
    shutil.rmtree(str(root))
