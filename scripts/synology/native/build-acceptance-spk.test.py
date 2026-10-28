import importlib.util
import pathlib
import tarfile
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('spk',pathlib.Path(__file__).with_name('build-acceptance-spk.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
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
    def test_output_overwrite_rejected(self):
        with self.assertRaisesRegex(ValueError,'must be new'):m.build(self.root,'unused',self.root)


if __name__=='__main__':unittest.main()
