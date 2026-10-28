import hashlib
import importlib.util
import pathlib
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('aux',pathlib.Path(__file__).with_name('attach-auxiliary.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class AuxiliaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.binary=self.root/'downloader'
        self.data=b'\x7fELF\x02\x01'+b'\0'*12+b'\x3e\0';self.binary.write_bytes(self.data)
        self.lock={'bytes':len(self.data),'sha256':hashlib.sha256(self.data).hexdigest()}
    def test_exact_native_binary(self):m.validate(self.binary,self.lock)
    def test_changed_hash_rejected(self):
        self.binary.write_bytes(self.data[:-1]+b'x')
        with self.assertRaisesRegex(ValueError,'identity'):m.validate(self.binary,self.lock)
    def test_wrong_architecture_rejected(self):
        self.binary.write_bytes(self.data[:-2]+b'\xb7\0');self.lock['sha256']=m.digest(self.binary)
        with self.assertRaisesRegex(ValueError,'x86_64'):m.validate(self.binary,self.lock)
    def test_symlink_rejected(self):
        link=self.root/'link';link.symlink_to(self.binary)
        with self.assertRaisesRegex(ValueError,'identity'):m.validate(link,self.lock)


if __name__=='__main__':unittest.main()
