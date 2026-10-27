#!/usr/bin/env python3
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("contract", pathlib.Path(__file__).with_name("payload-contract.py"))
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        for name in contract.REQUIRED + tuple("bin/" + tool for tool in
                ("ffmpeg", "ffprobe", "pdfinfo", "pdftoppm", "pdftotext", "ddjvu", "djvused")) + ("licenses/NOTICE",):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fixture")
        node = self.root / "bin/node"
        node.write_bytes(b"\x7fELF\x02\x01" + bytes(12) + b"\x3e\x00")
        node.chmod(0o755)
        self.manifest = {"schemaVersion": 1, "architecture": "x86_64", "sourceCommit": "a" * 40,
                         "buildImage": "sha256:" + "b" * 64, "files": contract.inventory(self.root)}
        self.manifest["components"] = [{"name": "fixture", "version": "1", "source": "https://example.test/source",
            "license": "MIT", "licenseFiles": ["licenses/NOTICE"], "sourceRequired": False,
            "files": list(self.manifest["files"])}]
        lock = {"node": {"binarySha256": contract.digest(node)},
                "libatomic": {"binarySha256": contract.digest(self.root / "lib/libatomic.so.1")}}
        original = pathlib.Path.read_text
        def read(path, *args, **kwargs):
            if path.name == "runtime-source-lock.json": return json.dumps(lock)
            return original(path, *args, **kwargs)
        self.mock = patch.object(pathlib.Path, "read_text", read)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def test_complete_payload(self):
        self.assertEqual(contract.validate(self.root, self.manifest)["components"], 1)

    def test_modified_binary_rejected(self):
        (self.root / "bin/node").write_bytes(b"wrong")
        with self.assertRaisesRegex(ValueError, "inventory mismatch"):
            contract.validate(self.root, self.manifest)

    def test_untracked_environment_rejected(self):
        (self.root / "app/.env.production").write_text("private")
        with self.assertRaisesRegex(ValueError, "Private configuration"):
            contract.validate(self.root, self.manifest)

    def test_escaping_symlink_rejected(self):
        (self.root / "app/link").symlink_to("../../outside")
        with self.assertRaises((ValueError, FileNotFoundError)):
            contract.inventory(self.root)

    def test_absolute_symlink_rejected(self):
        (self.root / "app/link").symlink_to(self.root / "app/LICENSE")
        with self.assertRaisesRegex(ValueError, "cannot be relocated"):
            contract.inventory(self.root)

    def test_runtime_data_rejected(self):
        (self.root / "data").mkdir()
        with self.assertRaisesRegex(ValueError, "Runtime data"):
            contract.inventory(self.root)

    def test_unlicensed_file_rejected(self):
        self.manifest["components"][0]["files"].remove("app/LICENSE")
        with self.assertRaisesRegex(ValueError, "without a component audit"):
            contract.validate(self.root, self.manifest)

    def test_required_source_rejected(self):
        self.manifest["components"][0]["sourceRequired"] = True
        with self.assertRaisesRegex(ValueError, "corresponding source"):
            contract.validate(self.root, self.manifest)

    def test_license_path_rejected(self):
        self.manifest["components"][0]["licenseFiles"] = ["app/LICENSE"]
        with self.assertRaisesRegex(ValueError, "license files"):
            contract.validate(self.root, self.manifest)

    def test_architecture_rejected(self):
        self.manifest["architecture"] = "aarch64"
        with self.assertRaisesRegex(ValueError, "architecture"):
            contract.validate(self.root, self.manifest)


if __name__ == "__main__":
    unittest.main()
