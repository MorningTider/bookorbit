import importlib.util
import os
import json
import types
from unittest.mock import patch
import pathlib
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('cutover',pathlib.Path(__file__).with_name('cutover-native-app.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class NativeCutoverPolicy(unittest.TestCase):
    def source(self):
        env={key:'unchanged-secret'*3 for key in ['JWT_SECRET','SETUP_BOOTSTRAP_TOKEN','PODCAST_ENCRYPTION_KEY','BOOK_REQUEST_ENCRYPTION_KEY','EMAIL_ENCRYPTION_KEY','MIGRATION_ENCRYPTION_KEY']}
        env['DATABASE_URL']='postgres://role:secret@172.19.0.1:5433/bookorbit'
        return {'State':{'Running':True},'Config':{'Env':[key+'='+value for key,value in env.items()]},'Mounts':[{'Type':'bind','Destination':destination,'Source':source,'RW':rw} for destination,source,rw in [('/books','/volume1/library',False),('/books/ebook','/volume1/library/ebook',True),('/data','/volume1/docker/bookorbit/data/app',True)]]}
    def test_source_identity_and_mounts(self):
        source=self.source();self.assertIn('JWT_SECRET',m.source_info(source))
        source['Mounts'][0]['RW']=True
        with self.assertRaisesRegex(ValueError,'mounts'):m.source_info(source)
    def test_changed_database_rejected(self):
        source=self.source();source['Config']['Env']=[x.replace('/bookorbit','/postgres') for x in source['Config']['Env']]
        with self.assertRaisesRegex(ValueError,'production database'):m.source_info(source)
    def test_missing_encryption_key_rejected(self):
        source=self.source();source['Config']['Env']=[x for x in source['Config']['Env'] if not x.startswith('EMAIL_ENCRYPTION_KEY=')]
        with self.assertRaisesRegex(ValueError,'encryption'):m.source_info(source)
    def test_auth_preserved_but_database_and_paths_replaced(self):
        original=m.source_info(self.source());original.update(LIBRARY_BROWSE_ROOT='/books/ebook',NODE_OPTIONS='untrusted')
        new=m.copied_environment(original,'bookorbit_prod_new','role','a@b:c')
        for key in ['JWT_SECRET','PODCAST_ENCRYPTION_KEY','EMAIL_ENCRYPTION_KEY']:self.assertEqual(new[key],original[key])
        self.assertEqual(new['LIBRARY_BROWSE_ROOT'],'/volume1/library/ebook')
        self.assertIn('a%40b%3Ac@127.0.0.1:5433/bookorbit_prod_new',new['DATABASE_URL'])
        self.assertNotIn('NODE_OPTIONS',new)
    def test_private_data_copy_and_existing_target_rejection(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);source=root/'source';source.mkdir();(source/'private').write_text('contents')
            target=root/'new';m.copy_data(source,target,os.getuid(),os.getgid())
            self.assertEqual((target/'private').read_text(),'contents');self.assertEqual((target/'private').stat().st_mode&0o777,0o600)
            with self.assertRaisesRegex(ValueError,'must be new'):m.copy_data(source,target,os.getuid(),os.getgid())
    def test_symlink_source_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);source=root/'source';source.mkdir();(source/'link').symlink_to('/etc/passwd')
            with self.assertRaisesRegex(ValueError,'special files'):m.copy_data(source,root/'new',os.getuid(),os.getgid())


class NativeCutoverFailureRecovery(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name);self.state=self.root/'state';self.state.mkdir()
        (self.state/'data').mkdir();(self.state/'data/original').write_text('isolated')
        self.config=b'{"mode":"isolated"}';(self.state/'service.json').write_bytes(self.config)
        self.audits=self.root/'backups';self.audits.mkdir()
        self.calls=[];self.fail=None
        patcher=patch.object(m.os,'chown');patcher.start();self.addCleanup(patcher.stop)
        self.account=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())
        self.source={'Id':'original-container','Config':{'Image':'pinned-r21'}}
        self.env={'JWT_SECRET':'original'*8,'LIBRARY_BROWSE_ROOT':'/books'}
        for target,value in [('STATE',self.state),('AUDITS',self.audits)]:
            patcher=patch.object(m,target,value);patcher.start();self.addCleanup(patcher.stop)
        for target,value in [('pg',self.pg),('app_query',lambda _: '0'),('node',self.node),('health',lambda _:True),('copy_data',self.copy)]:
            patcher=patch.object(m,target,side_effect=value);patcher.start();self.addCleanup(patcher.stop)
        patcher=patch.object(m.prepare,'docker',side_effect=self.docker);patcher.start();self.addCleanup(patcher.stop)
        patcher=patch.object(m.subprocess,'run',side_effect=self.run_command);patcher.start();self.addCleanup(patcher.stop)
        patcher=patch.object(m.planner,'plan',return_value={'readyForIsolationReplay':True});patcher.start();self.addCleanup(patcher.stop)
    def pg(self,code,*args):
        if 'a.backup()' in code:
            if self.fail=='backup':raise RuntimeError('injected backup failure')
            return {'backup':str(self.root/'verified-backup'),'complete':True}
        if 'a.restore_copy(' in code:return {'password':'fresh-secret'}
        return {}
    def node(self,script,env,args=(),output=None):
        return {'passed':True} if script.startswith('replay') else {'matches':[],'auditComplete':True}
    def copy(self,source,destination,uid,gid):
        if self.fail=='copy':raise RuntimeError('injected copy failure')
        destination.mkdir();(destination/'new').write_text('production copy')
    def run_command(self,command,**kwargs):
        self.calls.append(command)
        if command[0]=='tar' and 'stdout' in kwargs and kwargs['stdout']!=m.subprocess.DEVNULL:kwargs['stdout'].write(b'fake-tar')
        if command[:2]==['/usr/syno/bin/synopkg','start'] and self.fail=='start':raise RuntimeError('injected startup failure')
        return types.SimpleNamespace(returncode=0)
    def docker(self,method,path,body=None):
        self.calls.append([method,path,body])
        if path.endswith('/update') and self.fail=='update':raise RuntimeError('injected update failure')
    def execute(self):m.execute(self.source,self.env,self.account)
    def test_backup_failure_restarts_original_without_replacing_config(self):
        self.fail='backup'
        with self.assertRaises(RuntimeError):self.execute()
        self.assertTrue(any('/containers/bookorbit-app/start' in call for call in self.calls))
        self.assertEqual((self.state/'service.json').read_bytes(),self.config)
        self.assertTrue((self.state/'data/original').is_file())
    def test_data_copy_failure_restores_old_data_and_original_container(self):
        self.fail='copy'
        with self.assertRaises(RuntimeError):self.execute()
        self.assertTrue((self.state/'data/original').is_file())
        self.assertTrue(any('/containers/bookorbit-app/start' in call for call in self.calls))
    def test_start_failure_restores_private_configuration(self):
        self.fail='start'
        with self.assertRaises(RuntimeError):self.execute()
        self.assertEqual((self.state/'service.json').read_bytes(),self.config)
        self.assertEqual((self.state/'service.json').stat().st_mode&0o777,0o600)
        self.assertTrue((self.state/'data/original').is_file())
    def test_no_automatic_rollback_after_healthy_service(self):
        self.fail='update'
        with self.assertRaises(RuntimeError):self.execute()
        self.assertFalse(any('/containers/bookorbit-app/start' in call for call in self.calls))
        self.assertEqual(json.loads((self.state/'service.json').read_text())['mode'],'production')
        failure=next(self.audits.glob('*/failure.json'));self.assertTrue(json.loads(failure.read_text())['activated'])
    def test_success_preserves_old_configuration_data_and_container(self):
        self.execute()
        self.assertTrue(next(self.state.glob('data-before-cutover-*')).joinpath('original').is_file())
        self.assertTrue(next(self.audits.glob('*/isolated-service.json')).is_file())
        self.assertFalse(any('/containers/bookorbit-app/start' in call for call in self.calls))
        self.assertTrue(json.loads(next(self.audits.glob('*/activation.json')).read_text())['passed'])


if __name__=='__main__':unittest.main()
