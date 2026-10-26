#!/usr/bin/env python3
"""Back up BookOrbit's container DB with a consistent exported PG snapshot.

The program only reads the source DB. Passwords remain inside NAS process memory.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import pwd
import select
import shutil
import subprocess
import sys


def digest(path):
    result=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--container',default='bookorbit-db');parser.add_argument('--output',type=pathlib.Path,required=True);parser.add_argument('--backup-owner',default='postgresql18');args=parser.parse_args()
    docker=shutil.which('docker') or '/var/packages/ContainerManager/target/usr/bin/docker'
    info=json.loads(subprocess.check_output([docker,'inspect',args.container],text=True))[0]
    if info['State']['Status']!='running':raise ValueError('Source database container must be running')
    env=dict(value.split('=',1) for value in info['Config']['Env'])
    role,database=env['POSTGRES_USER'],env['POSTGRES_DB']
    owner=pwd.getpwnam(args.backup_owner)
    output=args.output
    if not output.is_absolute() or output.exists() or output.is_symlink():raise ValueError('Use a new absolute backup directory')
    output.mkdir(mode=0o700);os.chown(str(output),owner.pw_uid,owner.pw_gid)
    connection=subprocess.Popen([docker,'exec','-i',args.container,'psql','-qAt','-v','ON_ERROR_STOP=1','-U',role,'-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    def send(statement):connection.stdin.write(statement+';\n');connection.stdin.flush()
    def query(statement):
        send(statement)
        if not select.select([connection.stdout],[],[],60)[0]:raise RuntimeError('Source snapshot query timed out')
        line=connection.stdout.readline()
        if not line:raise RuntimeError('Source snapshot query failed')
        return line.strip()
    def qid(value):return '"'+value.replace('"','""')+'"'
    def qliteral(value):return "'"+value.replace("'","''")+"'"
    try:
        send('SET standard_conforming_strings=on')
        send('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        snapshot=query('SELECT pg_export_snapshot()')
        if not all(c in '0123456789ABCDEF-' for c in snapshot):raise ValueError('Invalid exported snapshot identity')
        major=int(query('SHOW server_version_num'))//10000
        if major!=18:raise ValueError('Source PostgreSQL major is not the validated target major')
        extensions=json.loads(query("SELECT coalesce(json_agg(json_build_object('name',extname,'version',extversion) ORDER BY extname),'[]'::json) FROM pg_extension"))
        tables=json.loads(query("SELECT coalesce(json_agg(json_build_object('schema',schemaname,'name',tablename) ORDER BY schemaname,tablename),'[]'::json) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%';"))
        if not 1<=len(tables)<=1000:raise ValueError('Unexpected application table count')
        counts_sql=' UNION ALL '.join('SELECT '+qliteral(t['schema']+'.'+t['name'])+' AS name,count(*) AS rows FROM '+qid(t['schema'])+'.'+qid(t['name']) for t in tables)
        counts=json.loads(query('SELECT json_object_agg(name,rows) FROM ('+counts_sql+') AS counts'))
        dump=output/'database-0.dump'
        with dump.open('xb') as target:
            result=subprocess.run([docker,'exec',args.container,'pg_dump','-U',role,'-d',database,'-Fc','--snapshot',snapshot],stdout=target,stderr=subprocess.PIPE,timeout=600)
        if result.returncode:raise RuntimeError('Source snapshot dump failed')
        checked=subprocess.run([docker,'exec','-i',args.container,'pg_restore','--list'],stdin=dump.open('rb'),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=60)
        if checked.returncode:raise RuntimeError('Source dump directory validation failed')
        send('COMMIT');connection.stdin.close();connection.wait(timeout=30)
        if connection.returncode:raise RuntimeError('Source snapshot connection failed')
        globals_file=output/'globals.sql'
        with globals_file.open('xb') as target:
            result=subprocess.run([docker,'exec',args.container,'pg_dumpall','-U',role,'--globals-only'],stdout=target,stderr=subprocess.PIPE,timeout=120)
        if result.returncode:raise RuntimeError('Global role backup failed')
        manifest={'schemaVersion':1,'postgresqlMajor':major,'createdAtUtc':datetime.datetime.utcnow().isoformat()+'Z','source':{'container':args.container,'imageId':info['Image'],'consistentExportedSnapshot':True},'inventory':{'databases':[{'name':database,'extensions':extensions,'inspected':True}]},'databases':[{'name':database,'file':dump.name,'template':False}],'configuration':[],'rowCounts':counts,'files':[]}
        for path in [dump,globals_file]:
            path.chmod(0o600);os.chown(str(path),owner.pw_uid,owner.pw_gid)
            manifest['files'].append({'path':path.name,'bytes':path.stat().st_size,'sha256':digest(path)})
        temporary=output/'.manifest.pending'
        with temporary.open('x') as stream:
            json.dump(manifest,stream,indent=2);stream.flush();os.fsync(stream.fileno())
        temporary.chmod(0o600);os.chown(str(temporary),owner.pw_uid,owner.pw_gid);temporary.replace(output/'manifest.json')
        print(json.dumps({'backup':str(output),'database':database,'tables':len(tables),'dumpBytes':dump.stat().st_size,'dumpSha256':digest(dump),'extensions':extensions,'consistentSnapshot':True}))
    finally:
        if connection.poll() is None:
            connection.terminate()
            try:connection.wait(timeout=10)
            except subprocess.TimeoutExpired:connection.kill();connection.wait(timeout=10)

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as error:
        print('Source database backup failed: '+type(error).__name__,file=sys.stderr);raise SystemExit(1)
