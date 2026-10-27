import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

path=pathlib.Path(__file__).with_name('apply-native-pg-migration.py')
spec=importlib.util.spec_from_file_location('native_cutover',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class CutoverBoundaryTests(unittest.TestCase):
    def test_private_config_replace_preserves_owner_and_excludes_other_readers(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'env';path.write_bytes(b'old');before=path.stat()
            module.private_replace(path,b'new-private')
            self.assertEqual(path.read_bytes(),b'new-private')
            self.assertEqual((path.stat().st_uid,path.stat().st_gid),(before.st_uid,before.st_gid))
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertEqual([p.name for p in path.parent.iterdir()],['env'])

    def exercise_failure(self,after_commit):
        with tempfile.TemporaryDirectory() as directory:
            base=pathlib.Path(directory);root=base/'production';state=base/'state';backups=base/'backups';preflight=base/'preflight'
            for p in (root,state,backups,preflight,base/'app'):p.mkdir()
            original_env=b'JWT_SECRET=private-original\nAPP_IMAGE=pinned\nPOSTGRES_PASSWORD=old\n'
            (root/'.env').write_bytes(original_env);(root/'docker-compose.yml').write_bytes(b'original compose')
            (preflight/'native-compose-blueprint.json').write_text('{}')
            source={'Id':'oldid','Image':'sha256:exact','Name':'/bookorbit-app','Config':{'Image':'pinned','Env':['JWT_SECRET=private-original']},'HostConfig':{'RestartPolicy':{'Name':'unless-stopped'}},'Mounts':[{'Destination':'/data','Source':str(base/'app')}]}
            current={'Id':'newid','Image':'sha256:exact','Name':'/bookorbit-app','Config':{'Env':['POSTGRES_HOST=172.19.0.1','POSTGRES_DB=bookorbit']}}
            credentials={'database':'bookorbit','role':'bookorbit','password':'synthetic-test-secret-only'}
            calls=[];application_created=[False]
            def docker(method,url,body=None):
                calls.append((method,url,body))
                if method=='GET' and url=='/containers/bookorbit-app/json':return current if application_created[0] else source
                if method=='GET' and url=='/containers/oldid/json':return source
                if '/containers/oldid/rename?name=' in url:source['Name']='/'+url.split('name=',1)[1]
                if after_commit and url=='/containers/bookorbit-db/stop?t=60':raise RuntimeError('simulated follow-up interruption')
                return {}
            def command(arguments,**kwargs):
                if any('backup-container-db.py' in str(a) for a in arguments):
                    folder=pathlib.Path(arguments[-1]);folder.mkdir();(folder/'manifest.json').write_text(json.dumps({'rowCounts':{'public.books':1}}))
                    return types.SimpleNamespace(returncode=0,stdout=json.dumps({'database':'bookorbit'}))
                if 'config' in arguments:return types.SimpleNamespace(returncode=0,stdout=json.dumps({'services':{'app':{'image':'pinned','environment':{'JWT_SECRET':'private-original','POSTGRES_HOST':'172.19.0.1','POSTGRES_PASSWORD':credentials['password'],'POSTGRES_DB':'bookorbit'}}}}))
                if 'up' in arguments:application_created[0]=True
                return types.SimpleNamespace(returncode=0,stdout='')
            health=[None] if after_commit else [TimeoutError('simulated startup failure'),None]
            output=io.StringIO()
            with patch.object(module,'ROOT',root),patch.object(module,'PGSTATE',state),patch.object(module,'PGBACKUPS',backups),patch.object(module,'readiness',return_value=(source,{}, {'restore':{'tables':1}})),patch.object(module,'docker',side_effect=docker),patch.object(module,'source_sql',return_value='0'),patch.object(module,'native_query',return_value='1'),patch.object(module.prepare,'package_python',side_effect=[credentials,{'tables':1,'allRowCountsMatch':True},{'restartRequired':False}]),patch.object(module.subprocess,'run',side_effect=command),patch.object(module,'health_wait',side_effect=health),patch.object(module.sys,'argv',['apply','--preflight-root',str(preflight),'--execute']),contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
                with self.assertRaises((TimeoutError,RuntimeError)):module.main()
            self.assertNotIn(credentials['password'],output.getvalue())
            self.assertNotIn('private-original',output.getvalue())
            folder=next(state.iterdir())
            if after_commit:
                self.assertTrue((folder/'committed.json').exists())
                self.assertNotEqual((root/'.env').read_bytes(),original_env)
                self.assertNotEqual(source['Name'],'/bookorbit-app')
                self.assertFalse((folder/'rollback.json').exists())
            else:
                self.assertEqual((root/'.env').read_bytes(),original_env)
                self.assertEqual((root/'docker-compose.yml').read_bytes(),b'original compose')
                self.assertEqual(source['Name'],'/bookorbit-app')
                self.assertTrue((folder/'rollback.json').exists())
                self.assertFalse(any(url=='/containers/bookorbit-db/stop?t=60' for _,url,_ in calls))

    def test_pre_health_failure_restores_original_profile_and_application(self):
        self.exercise_failure(False)

    def test_post_commit_failure_never_points_users_back_to_stale_database(self):
        self.exercise_failure(True)


if __name__=='__main__':unittest.main()
