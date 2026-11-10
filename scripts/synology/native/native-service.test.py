import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

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
    def test_packaged_application_version_follows_the_installed_release(self):
        root=self.state/'package';root.mkdir()
        (root/'acceptance-build.json').write_text(json.dumps({'packageVersion':'3.7.0-10042'}))
        env=m.environment(root,self.state,m.configuration(self.state))
        self.assertEqual(env['APP_VERSION'],'v3.7.0')
    def test_invalid_packaged_application_version_is_rejected(self):
        root=self.state/'package';root.mkdir()
        (root/'acceptance-build.json').write_text(json.dumps({'packageVersion':'../../3.7'}))
        with self.assertRaisesRegex(ValueError,'Invalid package'):
            m.environment(root,self.state,m.configuration(self.state))
    def production_root(self):
        root=self.state/'package';root.mkdir()
        (root/'acceptance-build.json').write_text(json.dumps({'productionEnabled':True}))
        self.config.update(mode='production',port=8184)
        self.config['environment']['DATABASE_URL']='postgres://role:pass@127.0.0.1:5433/bookorbit_prod_native'
        self.save();return root
    def test_production_requires_package_capability(self):
        root=self.production_root()
        (root/'acceptance-build.json').write_text('{"productionEnabled":false}')
        with self.assertRaisesRegex(ValueError,'does not enable'):m.configuration(self.state,root)
    def test_production_accepted_only_with_reviewed_identity(self):
        root=self.production_root()
        config=m.configuration(self.state,root)
        self.assertEqual(m.environment(root,self.state,config)['HOST'],'0.0.0.0')
        self.config['environment']['DATABASE_URL']='postgres://role:pass@127.0.0.1:5433/postgres';self.save()
        with self.assertRaisesRegex(ValueError,'reviewed production'):m.configuration(self.state,root)
    def test_production_ports_are_fixed(self):
        root=self.production_root();self.config['port']=18185;self.save()
        with self.assertRaisesRegex(ValueError,'reviewed application'):m.configuration(self.state,root)
    def test_production_rejects_external_database(self):
        root=self.production_root();self.config['environment']['DATABASE_URL']=self.config['environment']['DATABASE_URL'].replace('127.0.0.1','172.19.0.1');self.save()
        with self.assertRaisesRegex(ValueError,'loopback'):m.configuration(self.state,root)
    def test_stale_pid_rejected(self):
        (self.state/'service.pid.json').write_text(json.dumps({'pid':os.getpid(),'startTicks':'invalid'}))
        self.assertFalse(m.alive(self.state))
    def test_atomic_receipt_private(self):
        path=self.state/'receipt.json';m.atomic(path,{'test':True})
        self.assertEqual(path.stat().st_mode&0o777,0o600)
        self.assertEqual(json.loads(path.read_text()),{'test':True})

    def test_runtime_receipts_do_not_wait_for_durable_storage(self):
        path=self.state/'service.pid.json'
        with patch.object(m.os,'fsync',side_effect=AssertionError('Disk sync blocked')):
            m.atomic(path,{'pid':123,'startTicks':'old'})
            m.atomic(path,{'pid':456,'startTicks':'new'})
        self.assertEqual(json.loads(path.read_text()),{'pid':456,'startTicks':'new'})
        self.assertEqual(path.stat().st_mode&0o777,0o600)
        self.assertEqual(list(self.state.glob('.service.pid.json-*')),[])
    def startup_wait(self, health):
        clock=[0]
        def sleep(seconds):clock[0]+=seconds
        with patch.object(m.time,'monotonic',side_effect=lambda:clock[0]), patch.object(m.time,'sleep',side_effect=sleep), patch.object(m,'alive',return_value=True), patch.object(m,'child_identity',return_value=123), patch.object(m,'healthy',side_effect=lambda port:health(clock[0])):
            result=m.wait_for_startup(self.state,self.state,18185)
        return result,clock[0]
    def test_slow_storage_readiness_survives_old_three_minute_limit(self):
        result,elapsed=self.startup_wait(lambda elapsed:elapsed>=240)
        self.assertTrue(result)
        self.assertEqual(elapsed,240)
    def test_unhealthy_child_has_bounded_startup(self):
        result,elapsed=self.startup_wait(lambda elapsed:False)
        self.assertFalse(result)
        self.assertEqual(elapsed,600)
    def test_healthy_http_without_owned_child_is_not_ready(self):
        clock=iter([0,1,601])
        with patch.object(m.time,'monotonic',side_effect=lambda:next(clock)), patch.object(m.time,'sleep'), patch.object(m,'alive',return_value=True), patch.object(m,'child_identity',return_value=None), patch.object(m,'healthy') as health:
            self.assertFalse(m.wait_for_startup(self.state,self.state,18185))
        health.assert_not_called()
    def test_exited_supervisor_fails_without_waiting_ten_minutes(self):
        (self.state/'last-exit.json').write_text('{"code":1}')
        with patch.object(m,'alive',return_value=False), patch.object(m.time,'sleep') as sleep:
            self.assertFalse(m.wait_for_startup(self.state,self.state,18185))
        sleep.assert_not_called()


if __name__=='__main__':unittest.main()
