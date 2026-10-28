#!/usr/bin/env python3
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("patch_poppler", pathlib.Path(__file__).with_name("patch-poppler.py"))
module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class PatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name);self.source = self.root / "GlobalParams.cc"
        self.source.write_text("// fixture\n" + module.NEEDLE + "\n")

    def test_reviewed_source_produces_patch_and_receipt(self):
        receipt = module.patch(self.source, self.root / "patch")
        self.assertNotEqual(receipt["beforeSha256"], receipt["afterSha256"])
        self.assertTrue((self.root / "patch/bookorbit-private-data.patch").is_file())
        self.assertIn('std::getenv("BOOKORBIT_POPPLER_DATADIR")', self.source.read_text())

    def test_changed_source_is_rejected_unchanged(self):
        self.source.write_text("unexpected source")
        with self.assertRaisesRegex(ValueError, "reviewed version"): module.patch(self.source, self.root / "patch")
        self.assertEqual(self.source.read_text(), "unexpected source")

    def test_ambiguous_source_is_rejected(self):
        self.source.write_text(module.NEEDLE + "\n" + module.NEEDLE)
        with self.assertRaises(ValueError): module.patch(self.source, self.root / "patch")
        self.assertFalse((self.root / "patch").exists())

    def test_already_patched_source_is_rejected(self):
        module.patch(self.source, self.root / "patch")
        with self.assertRaises(ValueError): module.patch(self.source, self.root / "second")


if __name__ == "__main__": unittest.main()
