#!/usr/bin/env python3
"""Plan reviewed path rewrites; never connect to or mutate a database."""
import argparse
import collections
import hashlib
import json
import pathlib

REVIEWED = {
    ('book_files', 'absolute_path'), ('books', 'folder_path'),
    ('library_dir_scan_state', 'dir_path'), ('library_folders', 'path'),
    ('book_dock_files', 'absolute_path'), ('book_dock_files', 'cover_path'),
    ('book_dock_unit_files', 'absolute_path'), ('upload_sessions', 'staging_path'),
    ('podcasts', 'local_folder_path'), ('podcast_episode_media', 'local_path'),
    ('download_client_path_mappings', 'local_path'), ('book_request_downloads', 'local_path'),
}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def validate_path(value):
    if not isinstance(value, str) or not value.startswith('/') or '\x00' in value or '\\' in value:
        raise ValueError('An absolute Linux path is required')
    path = pathlib.PurePosixPath(value)
    if '..' in path.parts or str(path) != value or value == '/':
        raise ValueError('Path must be canonical and not the filesystem root')
    return value


def mappings(entries):
    result = []
    for item in entries:
        old, new = validate_path(item['from']), validate_path(item['to'])
        if old == new or old in [x[0] for x in result]:
            raise ValueError('Duplicate or identity mapping')
        result.append((old, new))
    if not result:raise ValueError('Empty path map')
    for _, new in result:
        if any(new == old or new.startswith(old + '/') for old, _ in result):
            raise ValueError('Mapping destination re-enters a source prefix')
    return sorted(result, key=lambda x: (-len(x[0]), x[0]))


def translate(value, rules):
    validate_path(value)
    for old, new in rules:
        if value == old or value.startswith(old + '/'):
            return new + value[len(old):]
    return value


def plan(snapshot, entries):
    if snapshot.get('schemaVersion') != 1 or snapshot.get('readOnly') is not True or snapshot.get('auditComplete') is not True:
        raise ValueError('A read-only audit snapshot is required')
    rules = mappings(entries)
    if mappings(snapshot.get('mappings', [])) != rules:raise ValueError('Snapshot path map differs from plan map')
    operations, blocked, counts = [], [], collections.Counter()
    targets, seen = {}, set()
    for row in snapshot['matches']:
        key = (row['table'], row['column'])
        if row.get('kind') != 'scalar' or key not in REVIEWED:
            blocked.append({'table': key[0], 'column': key[1], 'reason': 'unreviewed-field', 'count': row['count']})
            continue
        old = row['value'];new = translate(old, rules)
        if old == new:raise ValueError('Snapshot match is outside the supplied path map')
        if not isinstance(row['count'], int) or isinstance(row['count'], bool) or row['count'] < 1:
            raise ValueError('Positive path occurrence count required')
        source = key + (old,);target = key + (new,)
        if source in seen:raise ValueError('Duplicate path audit group')
        seen.add(source)
        if target in targets and targets[target] != old:raise ValueError('Path mapping would merge distinct records')
        targets[target] = old
        if row.get('targetExists', True):
            blocked.append({'table': key[0], 'column': key[1], 'reason': 'destination-already-present', 'count': row['count']})
            continue
        operations.append({'table': key[0], 'column': key[1], 'old': old, 'new': new, 'expectedRows': row['count']})
        counts[key[0] + '.' + key[1]] += row['count']
    operations.sort(key=lambda x: (x['table'], x['column'], x['old']))
    return {'schemaVersion': 1, 'mode': 'plan-only', 'snapshotSha256': hashlib.sha256(canonical(snapshot)).hexdigest(),
            'mappings': [{'from': old, 'to': new} for old, new in rules], 'operations': operations,
            'rowCounts': dict(sorted(counts.items())), 'blocked': blocked,
            'readyForIsolationReplay': bool(operations) and not blocked,
            'productionRequirements': ['final backup', 'application stopped', 'fresh audit under transaction lock', 'isolated native PostgreSQL replay', 'package-user ACL verification']}


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--snapshot', required=True);parser.add_argument('--mappings', required=True);parser.add_argument('--output', required=True)
    args=parser.parse_args()
    report=plan(json.loads(pathlib.Path(args.snapshot).read_text()), json.loads(pathlib.Path(args.mappings).read_text()))
    import os
    fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as target:json.dump(report,target,ensure_ascii=False,indent=2)
    print(json.dumps({'mode': report['mode'], 'rowCounts': report['rowCounts'], 'blockedFields':len(report['blocked']), 'readyForIsolationReplay':report['readyForIsolationReplay']}))
