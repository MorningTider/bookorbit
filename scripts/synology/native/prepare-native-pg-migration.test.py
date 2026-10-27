import copy
import importlib.util
import pathlib
import unittest

path=pathlib.Path(__file__).with_name('prepare-native-pg-migration.py')
spec=importlib.util.spec_from_file_location('migration_preparation',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class MigrationPreparationTests(unittest.TestCase):
    def test_native_profile_keeps_application_and_optional_service_without_db_dependency(self):
        config={'name':'bookorbit','services':{'app':{'image':'old','environment':{'JWT_SECRET':'${JWT_SECRET?required}'},'depends_on':{'postgres':{'condition':'service_healthy'},'kokoro':{'condition':'service_started'}},'volumes':['/books:/books:ro']},'postgres':{'image':'pgvector'},'kokoro':{'profiles':['tts']}}}
        original=copy.deepcopy(config)
        actual=module.native_compose(config)
        self.assertEqual(config,original)
        self.assertNotIn('postgres',actual['services'])
        self.assertEqual(list(actual['services']['app']['depends_on']),['kokoro'])
        self.assertEqual(actual['services']['app']['volumes'],['/books:/books:ro'])
        self.assertEqual(actual['services']['app']['environment']['JWT_SECRET'],'${JWT_SECRET?required}')
        self.assertEqual(actual['services']['app']['image'],'${APP_IMAGE?required}')

    def test_resolved_environment_remains_linked_to_dotenv_credentials(self):
        config={'services':{'app':{'environment':{'JWT_SECRET':'old-secret','PORT':'3000','NODE_ENV':'production'}},'postgres':{}}}
        result=module.native_compose(config,['JWT_SECRET','PORT','NODE_ENV'])
        self.assertEqual(result['services']['app']['environment']['JWT_SECRET'],'${JWT_SECRET?required}')
        self.assertEqual(result['services']['app']['environment']['PORT'],'${PORT?required}')
        self.assertEqual(result['services']['app']['environment']['NODE_ENV'],'production')

    def test_last_database_dependency_removed_and_source_shape_checked(self):
        actual=module.native_compose({'services':{'app':{'depends_on':['postgres']},'postgres':{}}})
        self.assertNotIn('depends_on',actual['services']['app'])
        with self.assertRaises(ValueError):module.native_compose({'services':{'app':{}}})

    def test_native_env_replaces_duplicates_and_preserves_unrelated_secrets(self):
        credentials={'database':'bookorbit','role':'bookorbit','password':'a@b:c/$?xyz'}
        actual=module.native_env('# preserved\nJWT_SECRET=unchanged\nPOSTGRES_HOST=postgres\nPOSTGRES_HOST=other\nPOSTGRES_PASSWORD=old\n',credentials)
        self.assertIn('JWT_SECRET=unchanged',actual)
        self.assertEqual(actual.count('POSTGRES_HOST='),1)
        self.assertIn('POSTGRES_HOST="172.19.0.1"',actual)
        self.assertIn('a%40b%3Ac%2F%24%3Fxyz@172.19.0.1:5433/bookorbit',actual)
        self.assertNotIn('POSTGRES_PASSWORD=old',actual)

    def test_probe_preserves_exact_image_and_isolates_files_credentials_and_ports(self):
        source={'Image':'sha256:pinned','Config':{'Image':'floating','Hostname':'old','Env':['PUID=1000','PGID=1000','JWT_SECRET=production','POSTGRES_PASSWORD=production'],'Entrypoint':['/start'],'Labels':{'com.docker.compose.project':'production'}},'HostConfig':{'PortBindings':{'3000/tcp':[{'HostPort':'8184'}]},'RestartPolicy':{'Name':'unless-stopped'}},'Mounts':[{'Type':'bind','Source':'/prod/app','Destination':'/data'},{'Type':'bind','Source':'/library','Destination':'/books'}]}
        result,env=module.probe_config(source,{'database':'bookorbit_preflight_20261027','role':'probe','password':'isolated'},pathlib.Path('/isolated/app'))
        self.assertEqual(result['Image'],'sha256:pinned')
        self.assertNotEqual(env['JWT_SECRET'],'production')
        self.assertEqual(result['HostConfig']['PortBindings'],{})
        self.assertEqual(result['HostConfig']['RestartPolicy']['Name'],'no')
        self.assertEqual(result['HostConfig']['Binds'],['/isolated/app:/data:rw','/library:/books:ro'])
        self.assertEqual(result['HostConfig']['Memory'],1024*1024*1024)
        self.assertEqual(source['HostConfig']['RestartPolicy']['Name'],'unless-stopped')


if __name__=='__main__':unittest.main()
