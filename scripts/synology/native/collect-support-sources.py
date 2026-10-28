#!/usr/bin/env python3
"""Fetch exact Debian corresponding sources using authenticated APT source indexes."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import re
import subprocess


def source_plan(lock):
    items = set()
    for package in lock['debian']:
        name, version = package['source'], package['sourceVersion']
        if not re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', name) or not re.fullmatch(r'[A-Za-z0-9.+:~_-]+', version):
            raise ValueError('Invalid source identity')
        items.add((name, version))
    if not items or len(items) > 512:
        raise ValueError('Source plan must be bounded and nonempty')
    return sorted(items)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):value.update(chunk)
    return value.hexdigest()


def collect(lock_path, output):
    lock_path = pathlib.Path(lock_path).resolve(strict=True)
    plan = source_plan(json.loads(lock_path.read_text()))
    output = pathlib.Path(output).absolute()
    output.mkdir()  # Never mix new evidence with a previous, partially completed run.
    def fetch(entry):
        name, version = entry
        directory = output / (name + '-' + hashlib.sha256(version.encode()).hexdigest()[:12])
        directory.mkdir()
        with (directory / 'apt.log').open('w') as log:
            result = subprocess.run(['apt-get', 'source', '--download-only', '--only-source', name + '=' + version], cwd=directory, stdout=log, stderr=subprocess.STDOUT, timeout=600)
        if result.returncode:raise RuntimeError('Exact source unavailable: ' + name + '=' + version)
        dsc = list(directory.glob('*.dsc'))
        if len(dsc) != 1:raise ValueError('Missing or ambiguous source descriptor: ' + name)
        text = dsc[0].read_text()
        if '\nSource: ' + name + '\n' not in '\n' + text or '\nVersion: ' + version + '\n' not in '\n' + text:
            raise ValueError('Downloaded source identity differs: ' + name)
        records = re.search(r'\nChecksums-Sha256:\n((?: [^\n]+\n)+)', text)
        if not records:raise ValueError('Source descriptor lacks SHA256')
        files = {}
        for line in records[1].splitlines():
            checksum, size, filename = line.split()
            if pathlib.PurePosixPath(filename).name != filename or filename in ('.', '..'):
                raise ValueError('Invalid source member path')
            path = directory / filename
            if path.stat().st_size != int(size) or digest(path) != checksum:
                raise ValueError('Source member checksum differs: ' + name)
            files[filename] = checksum
        files[dsc[0].name] = digest(dsc[0])
        print(name + '=' + version + ' verified', flush=True)
        return {'name': name, 'version': version, 'directory': directory.name, 'files': files}
    successes, failures = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fetch, entry): entry for entry in plan}
        for future in concurrent.futures.as_completed(futures):
            try:successes.append(future.result())
            except Exception as error:failures.append({'source': futures[future][0], 'version': futures[future][1], 'error': str(error)[:300]})
    report = {'schemaVersion': 1, 'runtimeLockSha256': digest(lock_path), 'sources': sorted(successes, key=lambda x: (x['name'], x['version'])), 'failures': failures, 'passed': not failures}
    (output / 'source-receipt.json').write_text(json.dumps(report, indent=2) + '\n')
    if failures:raise RuntimeError('Some exact corresponding sources remain unavailable; inspect receipt')


if __name__ == '__main__':
    parser = argparse.ArgumentParser();parser.add_argument('--lock', required=True);parser.add_argument('--output', required=True)
    args = parser.parse_args();collect(args.lock, args.output)
