#!/usr/bin/env python3
import base64
import hashlib
import importlib.util
import json
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("source_build", pathlib.Path(__file__).with_name("source-build.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class SourceBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        self.repo = self.root / "repo";self.repo.mkdir()
        native = self.repo / "scripts/synology/native";native.mkdir(parents=True)
        self.lock = native / "runtime-source-lock.json"
        self.data = {"sourceBuild": {"platform": "linux/amd64", "image": "node:26@sha256:" + "a" * 64,
            "pnpm": {"version": "11.22.0", "url": "https://example.test/pnpm.tgz",
                     "integrity": "sha512-" + base64.b64encode(hashlib.sha512(b"fixture").digest()).decode()}}}
        self.lock.write_text(json.dumps(self.data))
        (native / "Source.Dockerfile").write_text("FROM scratch")
        (self.repo / "package.json").write_text('{"packageManager":"pnpm@11.22.0"}')
        (self.repo / "pnpm-lock.yaml").write_text("lockfileVersion: 9.0")
        self.git("init", "--quiet")
        self.commit()
        self.cache = self.root / "cache";self.cache.mkdir()
        (self.cache / "pnpm-11.22.0.tgz").write_bytes(b"fixture")
        self.output = self.root / "out"

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, stderr=subprocess.PIPE)

    def commit(self):
        self.git("add", ".")
        self.git("-c", "user.name=Build test", "-c", "user.email=build@example.test", "-c", "core.hooksPath=/dev/null",
                 "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")

    def test_plan_records_exact_commit(self):
        report, _ = source.plan(self.repo)
        self.assertEqual(report["sourceCommit"], self.git("rev-parse", "HEAD").decode().strip())
        self.assertEqual(report["lockfileSha256"], hashlib.sha256(b"lockfileVersion: 9.0").hexdigest())

    def test_dirty_tracked_sources_rejected(self):
        (self.repo / "pnpm-lock.yaml").write_text("changed")
        with self.assertRaises(subprocess.CalledProcessError): source.plan(self.repo)

    def test_unpinned_image_rejected(self):
        self.data["sourceBuild"]["image"] = "node:latest";self.lock.write_text(json.dumps(self.data));self.commit()
        with self.assertRaisesRegex(ValueError, "digest-pinned"): source.plan(self.repo)

    def test_package_manager_mismatch_rejected(self):
        (self.repo / "package.json").write_text('{"packageManager":"pnpm@12.0.0"}');self.commit()
        with self.assertRaisesRegex(ValueError, "manager lock"): source.plan(self.repo)

    def test_cached_package_manager_tampering_rejected(self):
        (self.cache / "pnpm-11.22.0.tgz").write_bytes(b"bad")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            source.build(self.repo, self.output, self.cache)
        self.assertFalse(self.output.exists())

    def test_existing_output_preserved(self):
        self.output.mkdir();(self.output / "keep").write_text("keep")
        with self.assertRaisesRegex(ValueError, "new directory"):
            source.build(self.repo, self.output, self.cache)
        self.assertTrue((self.output / "keep").exists())

    def test_build_uses_committed_archive_without_local_credentials(self):
        (self.repo / ".env").write_text("PRIVATE")
        (self.repo / "node_modules").mkdir();(self.repo / "node_modules/host-native.node").write_bytes(b"mac")
        actual_run = subprocess.run
        def run(command, **kwargs):
            if command[0] != "docker": return actual_run(command, **kwargs)
            context = pathlib.Path(command[-1])
            with tarfile.open(context / "source.tar") as archive:
                self.assertNotIn(".env", archive.getnames())
                self.assertNotIn("node_modules/host-native.node", archive.getnames())
            result = json.loads((context / "source-build.json").read_text());result["sharpNativeCheck"] = True
            artifact = context / "artifact";(artifact / "sources").mkdir(parents=True)
            shutil.copyfile(context / "source.tar", artifact / "sources/bookorbit-source.tar")
            (artifact / "source-build.json").write_text(json.dumps(result))
        with patch.object(source.subprocess, "run", side_effect=run):
            report = source.build(self.repo, self.output, self.cache)
        self.assertTrue(report["sharpNativeCheck"])
        self.assertEqual(list(self.root.glob(".bookorbit-source-*")), [])

    def test_failed_compilation_does_not_leave_partial_output(self):
        actual_run = subprocess.run
        def run(command, **kwargs):
            if command[0] == "docker": raise subprocess.CalledProcessError(1, command)
            return actual_run(command, **kwargs)
        with patch.object(source.subprocess, "run", side_effect=run):
            with self.assertRaises(subprocess.CalledProcessError): source.build(self.repo, self.output, self.cache)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob(".bookorbit-source-*")), [])


if __name__ == "__main__": unittest.main()
