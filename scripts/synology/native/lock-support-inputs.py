#!/usr/bin/env python3
"""Freeze observed runtime package identities without trusting incomplete metadata."""
import argparse
import json
import pathlib
import re
import urllib.parse


def sha256(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('Missing SHA256')
    return value


def freeze(root):
    root = pathlib.Path(root)
    manifest = json.loads((root / 'support/support-manifest.json').read_text())
    debian = []
    seen = set()
    for package in manifest['debianPackages']:
        name = package['name'].split(':', 1)[0]
        if not re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', name) or name in seen:
            raise ValueError('Invalid or duplicate Debian package')
        seen.add(name)
        text = (root / 'support/licenses' / (name + '-apt-metadata.txt')).read_text()
        matches = []
        for paragraph in text.strip().split('\n\n'):
            fields = dict(line.split(': ', 1) for line in paragraph.splitlines() if ': ' in line and not line.startswith(' '))
            if fields.get('Package') == name and fields.get('Version') == package['version']:
                matches.append(fields)
        if len(matches) != 1:
            raise ValueError('Ambiguous Debian package metadata: ' + name)
        item = matches[0]
        path = pathlib.PurePosixPath(item['Filename'])
        if path.is_absolute() or '..' in path.parts or not str(path).startswith('pool/'):
            raise ValueError('Invalid Debian pool path')
        source = item.get('Source', name)
        match = re.fullmatch(r'([a-z0-9+.-]+)(?: \(([^()]+)\))?', source)
        if not match:
            raise ValueError('Invalid source package')
        debian.append({'name': name, 'version': package['version'], 'architecture': item['Architecture'],
                       'filename': str(path), 'sha256': sha256(item.get('SHA256')),
                       'source': match[1], 'sourceVersion': match[2] or package['version']})
    python = []
    seen = set()
    report = json.loads((root / 'pip-install.json').read_text())
    for item in report['install']:
        metadata = item['metadata']
        name = re.sub(r'[-_.]+', '-', metadata['name']).lower()
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name) or name in seen:
            raise ValueError('Invalid or duplicate Python package')
        seen.add(name)
        url = item['download_info']['url']
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname != 'files.pythonhosted.org' or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Unexpected Python artifact URL')
        kind = 'wheel' if parsed.path.endswith('.whl') else 'sdist' if parsed.path.endswith('.tar.gz') else None
        if kind is None:
            raise ValueError('Unexpected Python artifact format')
        version = metadata['version']
        if not re.fullmatch(r'[a-zA-Z0-9.+!_-]+', version):
            raise ValueError('Invalid Python version')
        archive = item['download_info']['archive_info']
        checksum = archive.get('hashes', {}).get('sha256')
        legacy = archive.get('hash', '')
        if checksum is None and legacy.startswith('sha256='):checksum = legacy[7:]
        if legacy and legacy != 'sha256=' + str(checksum):raise ValueError('Conflicting Python SHA256')
        python.append({'name': name, 'version': version, 'url': url, 'kind': kind,
                       'sha256': sha256(checksum)})
    if not debian or not python:
        raise ValueError('Empty runtime input list')
    return {'schemaVersion': 1, 'scope': 'runtime-inputs-only',
            'pending': ['build-toolchain lock', 'corresponding source acquisition', 'locked rebuild acceptance'],
            'debian': sorted(debian, key=lambda x: x['name']), 'python': sorted(python, key=lambda x: x['name'])}


def requirements(lock):
    return ''.join(item['name'] + ' @ ' + item['url'] + ' --hash=sha256:' + item['sha256'] + '\n' for item in lock['python'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    lock = freeze(args.artifact)
    output = pathlib.Path(args.output)
    with output.open('x') as stream:
        json.dump(lock, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'debian': len(lock['debian']), 'python': len(lock['python']), 'scope': lock['scope']}))
