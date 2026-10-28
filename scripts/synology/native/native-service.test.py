import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('service',pathlib.Path(__file__).with_name('native-service.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class ServicePolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.state=pathlib.Path(self.tmp.name)
        self.config={'schemaVersion':1,'mode':'isolated','port':18185,'environment':{'DATABASE_URL':'postgres://role:pass@127.0.0.1:5433/bookorbit_spk_pathcheck_test','JWT_SECRET':'a'*32,'SETUP_BOOTSTRAP_TOKEN':'b'*40}}
        self.save()
    def save(self):
        path=self.state/'service.json';path.write_text(json.dumps(self.config));path.chmod(0o600)
    def test_private_configuration(self):self.assertEqual(m.configuration(self.state)['port'],18185)
    def test_production_database_rejected(self):
        self.config['environment']['DATABASE_URL']='postgres://role:pass@127.0.0.1:5433/bookorbit';self.save()
        with self.assertRaisesRegex(ValueError,'isolated database'):m.configuration(self.state)
    def test_external_database_rejected(self):
        self.config['environment']['DATABASE_URL']=self.config['environment']['DATABASE_URL'].replace('127.0.0.1','192.168.50.235');self.save()
        with self.assertRaisesRegex(ValueError,'loopback'):m.configuration(self.state)
    def test_world_readable_configuration_rejected(self):
        (self.state/'service.json').chmod(0o644)
        with self.assertRaisesRegex(ValueError,'private'):m.configuration(self.state)
    def test_native_code_injection_rejected(self):
        self.config['environment']['NODE_OPTIONS']='--require /tmp/plugin';self.save()
        with self.assertRaisesRegex(ValueError,'Unsupported'):m.configuration(self.state)
    def test_privileged_port_rejected(self):
        self.config['port']=443;self.save()
        with self.assertRaisesRegex(ValueError,'unprivileged'):m.configuration(self.state)
    def test_weak_signing_key_rejected(self):
        self.config['environment']['JWT_SECRET']='short';self.save()
        with self.assertRaisesRegex(ValueError,'strong'):m.configuration(self.state)
    def test_missing_bootstrap_rejected(self):
        del self.config['environment']['SETUP_BOOTSTRAP_TOKEN'];self.save()
        with self.assertRaisesRegex(ValueError,'required'):m.configuration(self.state)
    def test_state_only_owned_runtime_paths(self):
        config=m.configuration(self.state);config['environment']['BOOK_DOCK_PATH']='/production/bookdock'
        env=m.environment(pathlib.Path('/candidate'),self.state,config)
        self.assertEqual(env['BOOK_DOCK_PATH'],str(self.state/'data/bookdock'))
        self.assertNotIn('NODE_OPTIONS',env)
    def test_bundled_auxiliary_path_authoritative(self):
        root=self.state/'package';(root/'bin').mkdir(parents=True);(root/'bin/tomato-downloader').write_text('fixture')
        env=m.environment(root,self.state,m.configuration(self.state))
        self.assertEqual(env['TOMATO_DOWNLOADER_PATH'],str(root/'bin/tomato-downloader'))
    def test_user_auxiliary_path_override_rejected(self):
        self.config['environment']['TOMATO_DOWNLOADER_PATH']='/tmp/untrusted';self.save()
        with self.assertRaisesRegex(ValueError,'Unsupported'):m.configuration(self.state)
    def test_python_cache_changes_on_package_revision(self):
        root=self.state/'package';root.mkdir();meta=root/'acceptance-build.json';meta.write_text('{"revision":1}')
        first=m.environment(root,self.state,m.configuration(self.state))['PYTHONPYCACHEPREFIX']
        meta.write_text('{"revision":2}')
        second=m.environment(root,self.state,m.configuration(self.state))['PYTHONPYCACHEPREFIX']
        self.assertNotEqual(first,second)
        self.assertTrue(first.startswith(str(self.state/'home/.cache/python')))
    def test_stale_pid_rejected(self):
        (self.state/'service.pid.json').write_text(json.dumps({'pid':os.getpid(),'startTicks':'invalid'}))
        self.assertFalse(m.alive(self.state))
    def test_atomic_receipt_private(self):
        path=self.state/'receipt.json';m.atomic(path,{'test':True})
        self.assertEqual(path.stat().st_mode&0o777,0o600)
        self.assertEqual(json.loads(path.read_text()),{'test':True})


if __name__=='__main__':unittest.main()
