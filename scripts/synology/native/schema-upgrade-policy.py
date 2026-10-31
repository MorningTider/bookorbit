#!/usr/bin/env python3
"""Apply only evidence-bound native application migrations during DSM upgrade."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import subprocess

REQUIRED_CHECKS = {'appendOnlySql', 'isolatedPg18Migration', 'isolatedHttpImports', 'previousSchemaReviewed'}


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def migration_digest(root):
    result = hashlib.sha256()
    files = sorted((root / 'app/migrations').rglob('*'))
    if not files:
        raise ValueError('Migration input is missing')
    for path in files:
        if path.is_file():
            result.update(path.relative_to(root).as_posix().encode() + b'\0' + bytes.fromhex(digest(path)))
    return result.hexdigest()


def validate_evidence(report, metadata, previous=None):
    if report.get('kind') != 'native-schema-upgrade-acceptance' or report.get('passed') is not True or report.get('postgresMajor') != 18:
        raise ValueError('Verified PostgreSQL 18 schema acceptance is required')
    for key in ['sourceCommit', 'applicationMigrationSha256', 'payloadInventorySha256']:
        if report.get(key) != metadata.get(key):
            raise ValueError('Schema acceptance differs from the packaged ' + key)
    checks = report.get('checks', {})
    if not REQUIRED_CHECKS <= checks.keys() or not all(value is True for value in checks.values()):
        raise ValueError('Schema acceptance checks are incomplete')
    allowed = report.get('allowedPreviousMigrationSha256', [])
    if not isinstance(allowed, list) or not allowed or any(not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value) for value in allowed):
        raise ValueError('Reviewed previous migration fingerprints are required')
    if previous is not None and previous not in allowed:
        raise ValueError('The installed schema was not reviewed for this package')
    return True


def upgrade(root, state, execute=False):
    root = pathlib.Path(root).resolve(strict=True)
    state = pathlib.Path(state).resolve(strict=True)
    metadata = json.loads((root / 'acceptance-build.json').read_text())
    guard = json.loads((state / 'upgrade-guard.json').read_text())
    previous = guard['oldMigrationSha256']
    expected = metadata['applicationMigrationSha256']
    receipt = root / 'schema-upgrade-acceptance.json'
    if not receipt.exists():
        if previous != expected or metadata.get('schemaUpgradeAcceptanceSha256'):
            raise ValueError('Database schema changed without matching acceptance evidence')
        return {'schemaChanged': False, 'migrationsRun': False, 'passed': True}
    if digest(receipt) != metadata.get('schemaUpgradeAcceptanceSha256'):
        raise ValueError('Schema acceptance file changed')
    if digest(pathlib.Path(__file__)) != metadata.get('schemaUpgradePolicySha256'):
        raise ValueError('Schema upgrade policy changed')
    validate_evidence(json.loads(receipt.read_text()), metadata, previous)
    if migration_digest(root) != expected:
        raise ValueError('Packaged migration files changed')
    result = {'schemaChanged': previous != expected, 'migrationsRun': False, 'passed': True}
    if not execute:
        return result
    if os.geteuid() == 0 or state.stat().st_uid != os.geteuid() or state.stat().st_mode & 0o077:
        raise ValueError('Use the dedicated package account and private state')
    spec = importlib.util.spec_from_file_location('native_schema_controller', root / 'native-service.py')
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    if native.alive(state) or native.child_identity(root, state) is not None:
        raise ValueError('Stop the native service before schema upgrade')
    config = native.configuration(state, root)
    environment = native.environment(root, state, config)
    log = state / 'schema-upgrade.log'
    if log.exists() and (log.is_symlink() or log.stat().st_uid != os.geteuid()):
        raise ValueError('Private migration log ownership is invalid')
    fd = os.open(str(log), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, 'ab', buffering=0) as output:
        process = subprocess.run([str(root / 'bin/node'), '--max-old-space-size=512', 'dist/scripts/migrate.js'], cwd=str(root / 'app'), env=environment, stdout=output, stderr=subprocess.STDOUT, timeout=180)
    if process.returncode:
        raise ValueError('Native migration failed; inspect the private migration log')
    result.update(migrationsRun=True, sourceCommit=metadata['sourceCommit'], applicationMigrationSha256=expected)
    native.atomic(state / 'schema-upgrade-result.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(upgrade(args.root, args.state, args.execute)))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        raise SystemExit('Native schema upgrade refused or failed; configuration and private logs are retained')
