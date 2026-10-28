import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('lock', pathlib.Path(__file__).with_name('lock-support-inputs.py'))
lock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lock)


class LockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'support/licenses').mkdir(parents=True)
        (self.root / 'support/support-manifest.json').write_text(json.dumps({'debianPackages': [{'name': 'libfoo:amd64', 'version': '1:2.0-3'}]}))
        self.apt = self.root / 'support/licenses/libfoo-apt-metadata.txt'
        self.metadata = 'Package: libfoo\nVersion: 1:2.0-3\nArchitecture: amd64\nSource: foo (1:2.0-2)\nFilename: pool/main/f/foo/libfoo.deb\nSHA256: ' + 'a' * 64 + '\n'
        self.apt.write_text(self.metadata)
        self.report = {'install': [{'metadata': {'name': 'Foo_Bar', 'version': '2.1'}, 'download_info': {'url': 'https://files.pythonhosted.org/packages/foo.whl', 'archive_info': {'hashes': {'sha256': 'b' * 64}}}}]}
        self.write_report()

    def write_report(self):
        (self.root / 'pip-install.json').write_text(json.dumps(self.report))

    def test_exact_binary_and_source_versions(self):
        result = lock.freeze(self.root)
        self.assertEqual(result['debian'][0]['sourceVersion'], '1:2.0-2')
        self.assertEqual(result['debian'][0]['version'], '1:2.0-3')
        self.assertEqual(result['python'][0]['name'], 'foo-bar')
        self.assertIn('--hash=sha256:' + 'b' * 64, lock.requirements(result))

    def test_duplicate_apt_records_rejected(self):
        self.apt.write_text(self.metadata + '\n' + self.metadata)
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            lock.freeze(self.root)

    def test_mismatched_version_rejected(self):
        self.apt.write_text(self.metadata.replace('Version: 1:2.0-3', 'Version: 2.0-4'))
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            lock.freeze(self.root)

    def test_missing_hash_rejected(self):
        self.apt.write_text(self.metadata.replace('SHA256:', 'Other:'))
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            lock.freeze(self.root)

    def test_pool_traversal_rejected(self):
        self.apt.write_text(self.metadata.replace('pool/main/f/foo/libfoo.deb', 'pool/../secret'))
        with self.assertRaisesRegex(ValueError, 'pool path'):
            lock.freeze(self.root)

    def test_python_url_credentials_and_queries_rejected(self):
        for url in ['http://files.pythonhosted.org/a.whl', 'https://evil.example/a.whl', 'https://user:secret@files.pythonhosted.org/a.whl', 'https://files.pythonhosted.org/a.whl?token=secret']:
            self.report['install'][0]['download_info']['url'] = url
            self.write_report()
            with self.assertRaisesRegex(ValueError, 'URL'):
                lock.freeze(self.root)

    def test_source_distribution_explicit(self):
        self.report['install'][0]['download_info']['url'] = 'https://files.pythonhosted.org/packages/foo.tar.gz'
        self.write_report()
        self.assertEqual(lock.freeze(self.root)['python'][0]['kind'], 'sdist')

    def test_pip_legacy_hash_report(self):
        self.report['install'][0]['download_info']['archive_info'] = {'hash': 'sha256=' + 'b' * 64}
        self.write_report()
        self.assertEqual(lock.freeze(self.root)['python'][0]['sha256'], 'b' * 64)

    def test_conflicting_hashes_rejected(self):
        self.report['install'][0]['download_info']['archive_info']['hash'] = 'sha256=' + 'c' * 64
        self.write_report()
        with self.assertRaisesRegex(ValueError, 'Conflicting'):lock.freeze(self.root)

    def test_python_duplicate_normalized_names_rejected(self):
        self.report['install'].append(self.report['install'][0])
        self.write_report()
        with self.assertRaisesRegex(ValueError, 'duplicate Python'):
            lock.freeze(self.root)


if __name__ == '__main__':
    unittest.main()
