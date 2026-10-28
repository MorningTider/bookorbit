import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('builder', pathlib.Path(__file__).with_name('build-support.py'))
builder = importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


class BuildInputsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        (self.root / 'lock-support-inputs.py').write_bytes(pathlib.Path(__file__).with_name('lock-support-inputs.py').read_bytes())
        self.runtime = {'schemaVersion': 1, 'debian': [{'name': 'libfoo', 'version': '1:2.3-4'}], 'python': [{'name': 'foo', 'version': '1.0', 'url': 'https://files.pythonhosted.org/foo.whl', 'sha256': 'a' * 64}]}
        self.packages = [{'name': 'libfoo', 'version': '1:2.3-4', 'architecture': 'amd64'}]
        self.save()

    def save(self):
        (self.root / 'support-runtime-lock.json').write_text(json.dumps(self.runtime))
        (self.root / 'support-toolchain-lock.json').write_text(json.dumps(self.packages))

    def test_exact_pins(self):
        pins, requirements = builder.inputs(self.root)
        self.assertEqual(pins, 'libfoo=1:2.3-4\n')
        self.assertIn('--hash=sha256:' + 'a' * 64, requirements)

    def test_disagreement_rejected(self):
        self.packages[0]['version'] = '2.0';self.save()
        with self.assertRaisesRegex(ValueError, 'disagree'):builder.inputs(self.root)

    def test_duplicate_rejected(self):
        self.packages.append(self.packages[0]);self.save()
        with self.assertRaisesRegex(ValueError, 'Duplicate'):builder.inputs(self.root)

    def test_shell_input_rejected(self):
        self.packages[0]['version'] = '1;touch /tmp/test';self.save()
        with self.assertRaisesRegex(ValueError, 'identity'):builder.inputs(self.root)

    def test_foreign_architecture_rejected(self):
        self.packages[0]['architecture'] = 'arm64';self.save()
        with self.assertRaisesRegex(ValueError, 'unsupported'):builder.inputs(self.root)

    def test_existing_output_rejected(self):
        with self.assertRaisesRegex(ValueError, 'must be new'):builder.build(self.root, self.root)


if __name__ == '__main__':unittest.main()
