#!/usr/bin/env python3
import importlib.util
import io
import json
import os
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("stage", pathlib.Path(__file__).with_name("stage-application-payload.py"))
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        self.output = self.root / "payload"
        self.materials = self.root / "materials"
        self.materials.mkdir()
        node = b"test executable"
        archive = self.materials / "bookorbit-node-v26.11.1-linux-x64.tar.xz"
        with tarfile.open(archive, "w:xz") as tar:
            for name, data in (("bin/node", node), ("LICENSE", b"license")):
                entry = tarfile.TarInfo("node-v26.11.1-linux-x64/" + name)
                entry.size = len(data)
                tar.addfile(entry, io.BytesIO(data))
        atomic = self.materials / "bookorbit-libatomic.so.1"
        atomic.write_bytes(b"runtime")
        sharp = self.materials / "sharp-native-probe-20261026.tgz"
        with tarfile.open(sharp, "w:gz") as tar:
            entry = tarfile.TarInfo("node_modules/@img/fixture/NOTICE")
            entry.size = 7
            tar.addfile(entry, io.BytesIO(b"license"))
        import hashlib
        self.lock = {"media": {"baseImage": "sha256:" + "a" * 64},
                     "node": {"version": "26.11.1", "sha256": stage.sha(archive),
                              "binarySha256": hashlib.sha256(node).hexdigest()},
                     "libatomic": {"binarySha256": stage.sha(atomic)}}
        original = pathlib.Path.read_text
        def read(path, *args, **kwargs):
            if path.name == "runtime-source-lock.json": return json.dumps(self.lock)
            return original(path, *args, **kwargs)
        self.enter(patch.object(pathlib.Path, "read_text", read))
        actual_sha = stage.sha
        self.enter(patch.object(stage, "sha", lambda p: "511f01f0026fc97e9dcdc9ad88ce923503a01c742cabdaf835a2e601a9639c27" if p == sharp else actual_sha(p)))
        self.inspect = self.enter(patch.object(stage.subprocess, "check_output", return_value=self.lock["media"]["baseImage"]))
        def export(args, **kwargs):
            dest = pathlib.Path(args[-1]);(dest / "package.json").write_text("{}")
        self.export = self.enter(patch.object(stage.subprocess, "run", side_effect=export))

    def enter(self, mock):
        value = mock.start();self.addCleanup(mock.stop);return value

    def run_stage(self):
        return stage.stage("isolated", self.materials, self.output, "docker")

    def test_exports_application_only_without_starting_container(self):
        result = self.run_stage()
        self.assertEqual(result["status"], "application-only-not-distributable")
        self.assertTrue((self.output / "bin/node").exists())
        self.assertEqual(self.export.call_args.args[0][1], "cp")
        self.assertTrue(self.output.with_name("payload.inventory.json").exists())

    def test_known_development_examples_excluded(self):
        def export(args, **kwargs):
            app = pathlib.Path(args[-1]);(app / ".env.example").write_text("sample")
            editor = app / "node_modules/example/.vscode/settings.json"
            editor.parent.mkdir(parents=True);editor.write_text("{}")
        self.export.side_effect = export
        self.run_stage()
        report = json.loads(self.output.with_name("payload.inventory.json").read_text())
        self.assertEqual(len(report["prunedDevelopmentFiles"]), 2)
        self.assertFalse((self.output / "app/.env.example").exists())

    def test_known_broken_build_workspace_link_excluded(self):
        def export(args, **kwargs):
            link = pathlib.Path(args[-1]) / "node_modules/.pnpm/node_modules/server"
            link.parent.mkdir(parents=True);link.symlink_to("../../../../app/server")
        self.export.side_effect = export
        self.run_stage()
        report = json.loads(self.output.with_name("payload.inventory.json").read_text())
        self.assertIn("app/node_modules/.pnpm/node_modules/server", report["prunedDevelopmentFiles"])

    def test_unknown_broken_link_rejected(self):
        def export(args, **kwargs): (pathlib.Path(args[-1]) / "unknown").symlink_to("missing")
        self.export.side_effect = export
        with self.assertRaises(FileNotFoundError): self.run_stage()
        self.assertFalse(self.output.exists())

    def test_private_umask_does_not_make_runtime_unreadable(self):
        previous = os.umask(0o077)
        try: self.run_stage()
        finally: os.umask(previous)
        self.assertEqual((self.output / "bin").stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.output / "lib/libatomic.so.1").stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)

    def test_wrong_image_rejected_before_export(self):
        self.inspect.return_value = "sha256:" + "b" * 64
        with self.assertRaisesRegex(ValueError, "source lock"): self.run_stage()
        self.export.assert_not_called()

    def test_changed_container_rejected(self):
        self.inspect.side_effect = [self.lock["media"]["baseImage"], "wrong"]
        with self.assertRaisesRegex(ValueError, "changed"): self.run_stage()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob(".bookorbit-stage-*")), [])

    def test_bad_runtime_rejected_before_export(self):
        (self.materials / "bookorbit-libatomic.so.1").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "materials"): self.run_stage()
        self.export.assert_not_called()

    def test_exported_private_environment_rejected_and_cleaned(self):
        def export(args, **kwargs): (pathlib.Path(args[-1]) / ".env").write_text("private")
        self.export.side_effect = export
        with self.assertRaisesRegex(ValueError, "Private"): self.run_stage()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob(".bookorbit-stage-*")), [])

    def test_existing_output_preserved(self):
        self.output.mkdir();(self.output / "keep").write_text("keep")
        with self.assertRaisesRegex(ValueError, "new directory"): self.run_stage()
        self.assertEqual((self.output / "keep").read_text(), "keep")


if __name__ == "__main__": unittest.main()
