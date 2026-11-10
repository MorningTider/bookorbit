import importlib.util
import json
import pathlib
import tarfile
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('spk',pathlib.Path(__file__).with_name('build-acceptance-spk.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
    def test_cli_evidence_path_accepts_string(self):
        path=self.root/'receipt.json';path.write_text('{}')
        self.assertEqual(m.digest(str(path)),m.digest(path))
    def test_migration_content_bound(self):
        path=self.root/'app/migrations';path.mkdir(parents=True);(path/'001.sql').write_text('select 1;')
        first=m.migration_digest(self.root);(path/'001.sql').write_text('select 2;')
        self.assertNotEqual(first,m.migration_digest(self.root))
    def test_migration_rename_bound(self):
        path=self.root/'app/migrations';path.mkdir(parents=True);(path/'001.sql').write_text('select 1;')
        first=m.migration_digest(self.root);(path/'001.sql').rename(path/'002.sql')
        self.assertNotEqual(first,m.migration_digest(self.root))
    def test_empty_migrations_rejected(self):
        with self.assertRaisesRegex(ValueError,'missing'):m.migration_digest(self.root)
    def test_tar_normalizes_owner_and_preserves_executable(self):
        source=self.root/'script';source.write_text('#!/bin/sh\nexit 0\n');source.chmod(0o755)
        archive=self.root/'out.tar'
        with tarfile.open(archive,'w') as tar:m.member(tar,source,'scripts/start-stop-status')
        with tarfile.open(archive) as tar:
            info=tar.getmember('scripts/start-stop-status');self.assertEqual(info.uid,0);self.assertEqual(info.mtime,0);self.assertEqual(info.mode,0o755)
    def test_production_capability_requires_installed_acceptance(self):
        path=self.root/'proof.json';path.write_text(json.dumps({'passed':True}))
        with self.assertRaisesRegex(ValueError,'upgrade acceptance'):m.production_acceptance(path)
    def test_production_capability_acceptance(self):
        checks={name:True for name in ['databaseHealthy','copiedBooksQueryable','bookDetail','bundledDownloaderConfigured','fourParallelDetails','nativeHostPathAndRange','frontendServed','anonymousRejected','dedicatedNativeProcess','productionStillHealthy']}
        path=self.root/'proof.json';value={'kind':'installed-native-isolated-api','passed':True,'packageVersion':'3.5.0-10001','tokensTransferred':False,'readOnlyApiRequests':True,'checks':checks};path.write_text(json.dumps(value))
        self.assertEqual(m.production_acceptance(path),m.digest(path))
        checks['dedicatedNativeProcess']=False;path.write_text(json.dumps(value))
        with self.assertRaises(ValueError):m.production_acceptance(path)
    def test_dsm7_package_icon_dimensions(self):
        import struct
        directory=pathlib.Path(__file__).with_name('spk')
        for name,size in [('PACKAGE_ICON.PNG',64),('PACKAGE_ICON_256.PNG',256)]:
            data=(directory/name).read_bytes()
            self.assertEqual(data[:8],b'\x89PNG\r\n\x1a\n')
            self.assertEqual(struct.unpack('>II',data[16:24]),(size,size))
    def test_invalid_application_version_is_rejected(self):
        for version in ['3.7','3.7.0-beta','03.7.0','../3.7.0']:
            with self.assertRaisesRegex(ValueError,'major.minor.patch'):
                m.build(self.root,'unused',self.root/'new',application_version=version)
    def test_output_overwrite_rejected(self):
        with self.assertRaisesRegex(ValueError,'must be new'):m.build(self.root,'unused',self.root)


if __name__=='__main__':unittest.main()
