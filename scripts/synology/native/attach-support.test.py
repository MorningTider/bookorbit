#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("attach_support", pathlib.Path(__file__).with_name("attach-support.py"))
module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class AttachTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name);self.stage = self.root / "stage";self.support = self.root / "support";self.output = self.root / "candidate"
        (self.stage / "bin").mkdir(parents=True);(self.stage / "bin/node").write_text("source node")
        (self.support / "bin").mkdir(parents=True);(self.support / "python/bin").mkdir(parents=True)
        (self.support / "private-lib").mkdir();(self.support / "private-lib/libfixture.so").write_bytes(b"library")
        elf = b"\x7fELF\x02\x01" + bytes(12) + b"\x3e\x00"
        (self.support / "private-lib/ld-linux-x86-64.so.2").write_bytes(elf)
        (self.support / "private-lib/ld-linux-x86-64.so.2").chmod(0o755)
        tools = {}
        for name in module.TOOLS:
            file = self.support / ("python/bin/python3.11" if name == "python3" else "bin/" + name)
            file.write_bytes(elf);file.chmod(0o755)
            if name != "python3": tools[name] = {"sha256": hashlib.sha256(elf).hexdigest()}
        self.manifest = {"schemaVersion": 1, "libcMode": "private-loader", "minimumKernel": "4.4", "tools": tools,
                         "libraries": {"libfixture.so": {"sha256": hashlib.sha256(b"library").hexdigest()}}}
        (self.support / "support-manifest.json").write_text(json.dumps(self.manifest))

    def test_new_candidate_keeps_original_stage(self):
        report = module.attach(self.stage, self.support, self.output)
        self.assertEqual(report["status"], "support-candidate-not-release")
        self.assertTrue((self.output / "bin/python3").is_file())
        self.assertFalse((self.stage / "support").exists())
        self.assertEqual((self.stage / "bin/node").read_text(), "source node")

    def test_library_tampering_rejected(self):
        (self.support / "private-lib/libfixture.so").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "library checksum"): module.attach(self.stage, self.support, self.output)
        self.assertFalse(self.output.exists())

    def test_wrong_architecture_rejected(self):
        (self.support / "bin/ffmpeg").write_bytes(b"ARM")
        with self.assertRaisesRegex(ValueError, "not Linux x86_64"): module.attach(self.stage, self.support, self.output)

    def test_cannot_overwrite_stage_executable(self):
        (self.stage / "bin/ffmpeg").write_text("existing")
        with self.assertRaisesRegex(ValueError, "overwrite"): module.attach(self.stage, self.support, self.output)
        self.assertEqual((self.stage / "bin/ffmpeg").read_text(), "existing")
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob(".bookorbit-support-*")), [])

    def test_escaping_support_link_rejected(self):
        (self.support / "escape").symlink_to("../stage/bin/node")
        with self.assertRaisesRegex(ValueError, "escapes"): module.attach(self.stage, self.support, self.output)

    def test_existing_output_preserved(self):
        self.output.mkdir();(self.output / "keep").write_text("existing")
        with self.assertRaisesRegex(ValueError, "must be new"): module.attach(self.stage, self.support, self.output)
        self.assertTrue((self.output / "keep").exists())


if __name__ == "__main__": unittest.main()
