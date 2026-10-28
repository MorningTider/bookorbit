#!/usr/bin/env python3
"""Build a fresh native support candidate from versioned runtime and toolchain inputs."""
import argparse
import importlib.util
import json
import pathlib
import re
import shutil
import subprocess
import tempfile


def inputs(directory):
    directory = pathlib.Path(directory)
    runtime = json.loads((directory / 'support-runtime-lock.json').read_text())
    packages = json.loads((directory / 'support-toolchain-lock.json').read_text())
    if runtime.get('schemaVersion') != 1 or not packages:
        raise ValueError('Unsupported support lock')
    pins = {}
    for item in packages:
        if not re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', item['name']) or not re.fullmatch(r'[A-Za-z0-9.+:~_-]+', item['version']):
            raise ValueError('Invalid toolchain package identity')
        if item['architecture'] not in ('amd64', 'all') or item['name'] in pins:
            raise ValueError('Duplicate or unsupported toolchain package')
        pins[item['name']] = item['version']
    for item in runtime['debian']:
        if pins.get(item['name']) != item['version']:
            raise ValueError('Runtime and toolchain locks disagree')
    spec = importlib.util.spec_from_file_location('lock_support', directory / 'lock-support-inputs.py')
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    for item in runtime['python']:
        url = module.urllib.parse.urlsplit(item['url'])
        if any(character.isspace() for character in item['url']) or url.scheme != 'https' or url.hostname != 'files.pythonhosted.org' or url.username or url.password or url.query or url.fragment:
            raise ValueError('Unexpected locked Python URL')
        module.sha256(item.get('sha256'))
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', item['name']):
            raise ValueError('Invalid Python identity')
    requirements = module.requirements(runtime)
    if not requirements or len(requirements.splitlines()) != len(runtime['python']):
        raise ValueError('Invalid Python lock')
    return '\n'.join(name + '=' + pins[name] for name in sorted(pins)) + '\n', requirements


def build(directory, output, docker='docker'):
    directory = pathlib.Path(directory).resolve(strict=True)
    output = pathlib.Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('Build output must be new')
    pins, requirements = inputs(directory)
    with tempfile.TemporaryDirectory(prefix='bookorbit-support-context-') as temporary:
        context = pathlib.Path(temporary)
        for name in ('Support.Dockerfile', 'prepare-support.sh', 'patch-poppler.py', 'build-poppler.sh', 'collect-support.py', 'support-abi.py'):
            shutil.copyfile(directory / name, context / ('Dockerfile' if name == 'Support.Dockerfile' else name))
        (context / 'apt-packages.lock').write_text(pins)
        (context / 'python-requirements.lock').write_text(requirements)
        (context / 'support-toolchain-lock.json').write_bytes((directory / 'support-toolchain-lock.json').read_bytes())
        subprocess.run([docker, 'buildx', 'build', '--platform', 'linux/amd64', '--target', 'artifact', '--output', 'type=local,dest=' + str(output), '--progress=plain', str(context)], check=True)
        spec = importlib.util.spec_from_file_location('freeze_built_support', directory / 'lock-support-inputs.py')
        module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        expected = json.loads((directory / 'support-runtime-lock.json').read_text())
        actual = module.freeze(output)
        if actual != expected:
            raise ValueError('Rebuilt support artifacts differ from locked identities or hashes')
        (output / 'locked-rebuild.json').write_text(json.dumps({'schemaVersion': 1, 'runtimeIdentitiesMatched': True, 'toolchainPackages': len(json.loads((directory / 'support-toolchain-lock.json').read_text())), 'status': 'support-candidate-not-release'}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    build(pathlib.Path(__file__).parent, args.output)
