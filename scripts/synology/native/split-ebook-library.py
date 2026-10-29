#!/usr/bin/env python3
"""Plan and transactionally split an existing ebook library without recreating file IDs."""
import argparse
import hashlib
import json
import pathlib
import re
import sys
import os
import secrets

EBOOKS={'txt','epub','kepub','pdf','mobi','azw3','azw','fb2','djvu','cbz','cbr','cb7'}
STRUCTURAL={'books','book_files','book_metadata','book_authors','book_genres','book_covers','comic_metadata','book_narrators'}


def literal(value):
    if '\x00' in value:raise ValueError('NUL is not valid SQL text')
    return "'"+value.replace("'","''")+"'"


def snapshot_sql(library_id):
    if type(library_id) is not int or library_id<=0:raise ValueError('Positive library ID required')
    n=str(library_id)
    return "SELECT jsonb_build_object('library',(SELECT to_jsonb(l) FROM libraries l WHERE id="+n+"),'books',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM books b WHERE library_id="+n+"),'[]'::jsonb),'files',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM book_files f JOIN books b ON b.id=f.book_id WHERE b.library_id="+n+"),'[]'::jsonb),'metadata',coalesce((SELECT jsonb_agg(jsonb_build_object('book_id',m.book_id,'title',m.title,'locked_fields',m.locked_fields) ORDER BY m.book_id) FROM book_metadata m JOIN books b ON b.id=m.book_id WHERE b.library_id="+n+"),'[]'::jsonb))"


def plan(snapshot):
    library=snapshot.get('library') or {}
    if library.get('type')!='books' or library.get('organization_mode')!='book_per_folder':raise ValueError('Existing folder-organized book library required')
    books=snapshot['books'];files=snapshot['files']
    if not books or len(books)>500 or len(files)>2000:raise ValueError('Library exceeds bounded migration scope')
    ids=[b['id'] for b in books]+[f['id'] for f in files]
    if any(type(i) is not int or i<=0 for i in ids) or len({f['id'] for f in files})!=len(files) or len({b['id'] for b in books})!=len(books):raise ValueError('Invalid stored row identity')
    if any(f['book_id'] not in {b['id'] for b in books} for f in files):raise ValueError('Unowned file in snapshot')
    metadata={x['book_id']:x for x in snapshot['metadata']};groups=[];targets=set()
    for book in books:
        if book['status']!='present':raise ValueError('Resolve missing or processing books first')
        owned=[f for f in files if f['book_id']==book['id']]
        if not owned or any(f['role']!='content' or f['format'] not in EBOOKS for f in owned):raise ValueError('Only ebook content files are supported by this repair')
        by_stem={}
        for file in owned:
            path=pathlib.PurePosixPath(file['absolute_path'])
            if not path.is_absolute() or '..' in path.parts:raise ValueError('Invalid stored file path')
            by_stem.setdefault((str(path.parent),path.stem.casefold()),[]).append(file)
        if book['primary_file_id'] not in {f['id'] for f in owned}:raise ValueError('Owned primary file required')
        for members in by_stem.values():
            if len({f['format'] for f in members})!=len(members):raise ValueError('Ambiguous same-format editions require review')
            survivor=any(f['id']==book['primary_file_id'] for f in members)
            primary=next((f for f in members if f['id']==book['primary_file_id']),members[0])
            target=primary['absolute_path']
            if target in targets:raise ValueError('Duplicate target book path')
            targets.add(target);title=pathlib.PurePosixPath(target).stem
            old=metadata.get(book['id'],{});current=old.get('title') or ''
            invalid=not re.search(r'[^\W_]',current,re.UNICODE) or bool(re.search('[\u2500-\u257f]',current))
            if survivor and invalid and 'title' in (old.get('locked_fields') or []):raise ValueError('Locked title requires explicit review')
            groups.append({'sourceBookId':book['id'],'reuseBookId':book['id'] if survivor else None,'targetPath':target,'primaryFileId':primary['id'],'fileIds':[f['id'] for f in members],'title':title,'replaceInvalidTitle':survivor and invalid})
    return {'schemaVersion':1,'kind':'ebook-file-organization-plan','libraryId':library['id'],'snapshot':snapshot,'groups':groups,'oldBooks':len(books),'newBooks':len(groups),'filesPreserved':len(files),'bookRecordPolicy':'preserve-on-original-primary-book'}


def related(admin,database,proof):
    refs=json.loads(admin.sql("SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT DISTINCT r.relname AS table_name,s.attname AS column_name,t.relname AS target FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=r.relnamespace JOIN pg_class t ON t.oid=c.confrelid CROSS JOIN LATERAL unnest(c.conkey,c.confkey) AS k(src,dst) JOIN pg_attribute s ON s.attrelid=r.oid AND s.attnum=k.src JOIN pg_attribute d ON d.attrelid=t.oid AND d.attnum=k.dst WHERE c.contype='f' AND ns.nspname='public' AND c.confrelid IN ('books'::regclass,'book_files'::regclass) AND d.attname='id' ORDER BY r.relname,s.attname) x",database))
    book_ids=','.join(str(x['id']) for x in proof['snapshot']['books']);file_ids=','.join(str(x['id']) for x in proof['snapshot']['files'])
    split_ids={g['sourceBookId'] for g in proof['groups'] if g['reuseBookId'] is None};tables={}
    if split_ids:
        split=','.join(map(str,sorted(split_ids)))
        retained=','.join(str(i) for g in proof['groups'] if g['reuseBookId'] in split_ids for i in g['fileIds'])
        guard="SELECT count(*) FROM reading_sessions WHERE book_id IN ("+split+") AND book_file_id IS NOT NULL AND book_file_id NOT IN ("+retained+")"
        if int(admin.sql(guard,database)):raise ValueError('Reading sessions on non-primary split files require explicit mapping')
        guard="SELECT count(*) FROM reading_progress p JOIN book_files f ON f.id=p.book_file_id JOIN user_book_status s ON s.book_id=f.book_id AND s.user_id=p.user_id WHERE f.book_id IN ("+split+") AND f.id NOT IN ("+retained+")"
        if int(admin.sql(guard,database)):raise ValueError('Reading state on non-primary split files requires explicit mapping')
    for row in refs:
        table=row['table_name'];column=row['column_name']
        if not re.fullmatch('[a-z_]+',table) or not re.fullmatch('[a-z_]+',column):raise ValueError('Unsupported reference identity')
        if split_ids and row['target']=='books' and table not in STRUCTURAL:
            count=int(admin.sql('SELECT count(*) FROM "'+table+'" WHERE "'+column+'" IN ('+','.join(map(str,sorted(split_ids)))+')',database))
            if count and table not in {'reading_attempts','reading_sessions','user_book_status'}:raise ValueError('Book-level records on a split book need explicit mapping: '+table)
        if table not in STRUCTURAL:
            tables.setdefault(table,[]).append('"'+column+'" IN ('+(book_ids if row['target']=='books' else file_ids)+')')
    result={}
    for table,conditions in tables.items():
        where=' OR '.join(conditions)
        result[table]=json.loads(admin.sql("SELECT json_build_object('rows',count(*),'digest',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''))) FROM \""+table+'\" t WHERE '+where,database))
    return result


def transaction(proof):
    snapshot=proof['snapshot'];library_id=proof['libraryId'];expected=literal(json.dumps(snapshot,ensure_ascii=False))+'::jsonb'
    statements=[]
    for group in proof['groups']:
        source=str(group['sourceBookId']);target=literal(group['targetPath']);primary=str(group['primaryFileId']);ids=','.join(map(str,group['fileIds']));title=literal(group['title'])
        if group['reuseBookId'] is not None:
            statements.append('target_id := '+source+'; UPDATE books SET folder_path='+target+',updated_at=now() WHERE id=target_id;')
            if group['replaceInvalidTitle']:statements.append('UPDATE book_metadata SET title='+title+',embedding=NULL,updated_at=now() WHERE book_id=target_id;')
        else:
            statements.append('INSERT INTO books (library_id,library_folder_id,folder_path,status,added_at) SELECT library_id,library_folder_id,'+target+",'present',added_at FROM books WHERE id="+source+' RETURNING id INTO target_id;')
            statements.append('INSERT INTO book_metadata(book_id,title,language) VALUES(target_id,'+title+', (SELECT language FROM book_metadata WHERE book_id='+source+'));')
        statements.append('UPDATE book_files SET book_id=target_id WHERE id IN ('+ids+'); UPDATE books SET primary_file_id='+primary+' WHERE id=target_id;')
    query=snapshot_sql(library_id)
    result="BEGIN; SET LOCAL standard_conforming_strings=on; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'; LOCK TABLE libraries,books,book_files,book_metadata IN SHARE ROW EXCLUSIVE MODE; DO $repair$ DECLARE current_state jsonb; target_id integer; BEGIN "+query.replace('SELECT jsonb_build_object','SELECT jsonb_build_object',1)+" INTO current_state; IF current_state IS DISTINCT FROM "+expected+" THEN RAISE EXCEPTION 'Migration snapshot is stale'; END IF; IF EXISTS (SELECT 1 FROM scan_jobs WHERE library_id="+str(library_id)+" AND status='running') THEN RAISE EXCEPTION 'A scan is running'; END IF; "+' '.join(statements)+" UPDATE libraries SET organization_mode='book_per_file',updated_at=now() WHERE id="+str(library_id)+"; DELETE FROM library_dir_scan_state WHERE library_folder_id IN (SELECT id FROM library_folders WHERE library_id="+str(library_id)+"); END $repair$; COMMIT;"

    delimiter='$repair_'+secrets.token_hex(16)+'$'
    while delimiter in result:delimiter='$repair_'+secrets.token_hex(16)+'$'
    result=result.replace('DO $repair$ DECLARE','DO '+delimiter+' DECLARE',1)
    prefix,suffix=result.rsplit('END $repair$; COMMIT;',1)
    return prefix+'END '+delimiter+'; COMMIT;'+suffix

def main():
    p=argparse.ArgumentParser();p.add_argument('--database',required=True);p.add_argument('--library-id',required=True,type=int);p.add_argument('--output',required=True);p.add_argument('--execute',action='store_true');p.add_argument('--backup');p.add_argument('--backup-source');a=p.parse_args()
    output=pathlib.Path(a.output)
    if output.exists():raise ValueError('New audit output required')
    if not re.fullmatch(r'bookorbit_(?:prod|spk_pathcheck)_[a-z0-9_]+',a.database):raise ValueError('Reviewed application database required')
    sys.path.insert(0,'/var/packages/postgresql18/target/bin');from pg_admin import Admin
    admin=Admin();snapshot=json.loads(admin.sql(snapshot_sql(a.library_id),a.database));proof=plan(snapshot)
    before=related(admin,a.database,proof)
    result={**proof,'executed':False,'protectedRecords':before,'protectedRecordsVerified':False}
    with output.open('x') as f:json.dump(result,f,indent=2,ensure_ascii=False)
    output.chmod(0o600)
    if a.execute:
        if not a.backup:raise ValueError('Verified database backup required')
        admin.verify_backup(a.backup)
        manifest=json.loads((pathlib.Path(a.backup)/'manifest.json').read_text())
        source=a.backup_source or a.database
        if a.database.startswith('bookorbit_prod_') and source!=a.database:raise ValueError('Production backup identity differs')
        if source not in {d['name'] for d in manifest['databases']}:raise ValueError('Database absent from verified backup')
        clients=int(admin.sql("SELECT count(*) FROM pg_stat_activity WHERE datname="+literal(a.database)+" AND pid<>pg_backend_pid() AND backend_type='client backend'",a.database))
        if clients:raise ValueError('Stop application clients before executing repair')
        admin.sql(transaction(proof),a.database)
        result['executed']=True
        output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
        after=related(admin,a.database,proof)
        if before!=after:raise RuntimeError('Protected record digest differs; preserve backup and inspect before starting application')
        files=json.loads(admin.sql("SELECT json_agg(f ORDER BY id) FROM book_files f WHERE id IN ("+','.join(str(f['id']) for f in snapshot['files'])+')',a.database))
        original={f['id']:{k:v for k,v in f.items() if k!='book_id'} for f in snapshot['files']}
        if any({k:v for k,v in f.items() if k!='book_id'}!=original[f['id']] for f in files):raise RuntimeError('Unexpected file record change')
    result['protectedRecordsVerified']=bool(a.execute)
    result['backup']=a.backup
    output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('snapshot','groups','protectedRecords')},ensure_ascii=False))


if __name__=='__main__':main()
