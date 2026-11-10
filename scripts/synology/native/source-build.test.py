#!/usr/bin/env python3
import base64
import hashlib
import importlib.util
import json
import pathlib
import shutil
import sqlite3
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

    def make_preload(self, extra=False):
        folder = self.root / "preload/v11"
        (folder / "files").mkdir(parents=True)
        index = sqlite3.connect(folder / "index.db")
        index.execute("CREATE TABLE package_index (key TEXT PRIMARY KEY, data BLOB)")
        index.execute("INSERT INTO package_index VALUES (?, ?)", ("sha512-fixture\tfixture@1.0.0", b"{}"))
        if extra: index.execute("INSERT INTO package_index VALUES (?, ?)", ("unexpected", b"{}"))
        index.commit();index.close()
        lock = self.root / "preload-lock.yaml"
        lock.write_text("packages:\n  fixture@1.0.0:\n    resolution: {integrity: sha512-fixture}\n")
        return folder.parent, lock

    def test_preload_requires_exact_pinned_identity(self):
        store, lock = self.make_preload()
        archive = self.root / "preload.tgz"
        key = source.preload(store, archive, {"preloadPackages": ["fixture@1.0.0"]}, lock)
        self.assertEqual(len(key), 16)
        with tarfile.open(archive) as tar: self.assertIn("v11/index.db", tar.getnames())

    def test_preload_does_not_archive_host_project_links(self):
        store, lock = self.make_preload()
        (store / "v11/projects").mkdir()
        (store / "v11/projects/host").symlink_to(self.repo)
        archive = self.root / "preload.tgz"
        source.preload(store, archive, {"preloadPackages": ["fixture@1.0.0"]}, lock)
        with tarfile.open(archive) as tar:
            self.assertFalse(any("projects" in name for name in tar.getnames()))

    def test_preload_rejects_extra_packages(self):
        store, lock = self.make_preload(extra=True)
        with self.assertRaisesRegex(ValueError, "exact pinned packages"):
            source.preload(store, self.root / "bad.tgz", {"preloadPackages": ["fixture@1.0.0"]}, lock)

    def test_preload_rejects_unlocked_package(self):
        store, lock = self.make_preload()
        with self.assertRaisesRegex(ValueError, "not pinned"):
            source.preload(store, self.root / "bad.tgz", {"preloadPackages": ["absent@1.0.0"]}, lock)

    def test_preload_rejects_links(self):
        store, lock = self.make_preload()
        (store / "v11/files/link").symlink_to(lock)
        with self.assertRaisesRegex(ValueError, "links are forbidden"):
            source.preload(store, self.root / "bad.tgz", {"preloadPackages": ["fixture@1.0.0"]}, lock)

    def test_dependency_archive_is_stable_across_source_only_commits(self):
        first = self.root / "first.tar";second = self.root / "second.tar"
        commit = self.git("rev-parse", "HEAD").decode().strip()
        source.dependency_archive(self.repo, commit, first)
        (self.repo / "README.md").write_text("Source-only change")
        self.commit()
        source.dependency_archive(self.repo, self.git("rev-parse", "HEAD").decode().strip(), second)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        (self.repo / "pnpm-lock.yaml").write_text("changed")
        self.commit()
        source.dependency_archive(self.repo, self.git("rev-parse", "HEAD").decode().strip(), second)
        self.assertNotEqual(first.read_bytes(), second.read_bytes())

    def test_dependency_archive_includes_new_worker_manifest_without_worker_sources(self):
        worker = self.repo / "workers/read-aloud"
        worker.mkdir(parents=True)
        (worker / "package.json").write_text('{"name":"@bookorbit/read-aloud-worker","version":"0.0.1"}')
        (worker / "main.ts").write_text("export {}")
        self.commit()
        archive = self.root / "dependency-inputs.tar"
        source.dependency_archive(self.repo, self.git("rev-parse", "HEAD").decode().strip(), archive)
        with tarfile.open(archive) as tar:
            self.assertIn("workers/read-aloud/package.json", tar.getnames())
            self.assertNotIn("workers/read-aloud/main.ts", tar.getnames())

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
            result = json.loads((context / "source-build.json").read_text());result["sharpNativeCheck"] = True;result["workspacePackagesChecked"] = ["@bookorbit/types", "@bookorbit/plugin-api"]
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
