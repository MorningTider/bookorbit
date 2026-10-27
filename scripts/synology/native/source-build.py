#!/usr/bin/env python3
"""Build committed BookOrbit sources on Linux, without reading a deployed container."""
import argparse
import base64
import hashlib
import json
import pathlib
import re
import shutil
import sqlite3
import tarfile
import subprocess
import tempfile
import urllib.request


def digest(path, algorithm="sha256"):
    value = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.digest()


def plan(root):
    root = pathlib.Path(root).resolve(strict=True)
    subprocess.run(["git", "diff-index", "--quiet", "HEAD", "--"], cwd=root, check=True)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("A committed source revision is required")
    lock = json.loads((root / "scripts/synology/native/runtime-source-lock.json").read_text())
    build = lock["sourceBuild"]
    if build["platform"] != "linux/amd64" or not re.fullmatch(r"node:[^@]+@sha256:[0-9a-f]{64}", build["image"]):
        raise ValueError("A digest-pinned Linux x86_64 build image is required")
    manager = json.loads((root / "package.json").read_text())["packageManager"]
    if manager != "pnpm@" + build["pnpm"]["version"]:
        raise ValueError("Package manager lock mismatch")
    return {"schemaVersion": 1, "sourceCommit": commit, "buildImage": build["image"],
            "platform": build["platform"], "pnpmVersion": build["pnpm"]["version"],
            "lockfileSha256": digest(root / "pnpm-lock.yaml").hex(), "status": "application-only-not-distributable"}, build


def preload(store, archive, config, lockfile):
    expected = set()
    text = pathlib.Path(lockfile).read_text()
    for selector in config.get("preloadPackages", []):
        quoted = re.escape("'" + selector + "'" if selector.startswith("@") else selector)
        match = re.search(r"\n  " + quoted + r":\n    resolution: \{integrity: (sha512-[^} ]+)\}", text)
        if not match:
            raise ValueError("Preload package is not pinned in the dependency lock")
        expected.add(match.group(1) + "\t" + selector)
    if store is None:
        with tarfile.open(archive, "w:gz"):
            pass
        return "none"
    store = pathlib.Path(store).resolve(strict=True)
    v11 = store / "v11"
    files = v11 / "files"
    if v11.is_symlink() or (v11 / "index.db").is_symlink() or files.is_symlink() or any(p.is_symlink() for p in files.rglob("*")):
        raise ValueError("Preload cache links are forbidden")
    with sqlite3.connect((v11 / "index.db").as_uri() + "?immutable=1", uri=True) as index:
        actual = {row[0] for row in index.execute("SELECT key FROM package_index")}
    if not expected or actual != expected:
        raise ValueError("Preload cache does not match the exact pinned packages")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(v11 / "index.db", arcname="v11/index.db")
        tar.add(v11 / "files", arcname="v11/files")
    return hashlib.sha256("\n".join(sorted(actual)).encode()).hexdigest()[:16]


def build(root, output, cache, docker="docker", preload_store=None):
    root = pathlib.Path(root).resolve(strict=True)
    output = pathlib.Path(output).absolute()
    cache = pathlib.Path(cache).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError("Output must be a new directory")
    report, config = plan(root)
    cache.mkdir(parents=True, exist_ok=True)
    manager = cache / ("pnpm-" + config["pnpm"]["version"] + ".tgz")
    algorithm, expected = config["pnpm"]["integrity"].split("-", 1)
    if algorithm != "sha512":
        raise ValueError("Unsupported package manager integrity")
    if not manager.exists():
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as downloaded:
            candidate = pathlib.Path(downloaded.name)
            try:
                with urllib.request.urlopen(config["pnpm"]["url"], timeout=60) as response:
                    shutil.copyfileobj(response, downloaded)
                downloaded.flush()
                if digest(candidate, algorithm) != base64.b64decode(expected, validate=True):
                    raise ValueError("Package manager integrity mismatch")
                candidate.replace(manager)
            finally:
                candidate.unlink(missing_ok=True)
    if digest(manager, algorithm) != base64.b64decode(expected, validate=True):
        raise ValueError("Package manager integrity mismatch")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".bookorbit-source-", dir=output.parent) as directory:
        context = pathlib.Path(directory)
        archive = context / "source.tar"
        subprocess.run(["git", "archive", "--format=tar", "--output=" + str(archive), report["sourceCommit"]], cwd=root, check=True)
        report["sourceArchiveSha256"] = digest(archive).hex()
        (context / "source-build.json").write_text(json.dumps(report, indent=2))
        shutil.copyfile(manager, context / "pnpm.tgz")
        shutil.copyfile(root / "scripts/synology/native/Source.Dockerfile", context / "Dockerfile")
        # Export into the private context first; never leave a partial requested output.
        preload_key = preload(preload_store, context / "preload-store.tgz", config, root / "pnpm-lock.yaml")
        report["preloadCacheKey"] = preload_key
        (context / "source-build.json").write_text(json.dumps(report, indent=2))
        artifact = context / "artifact"
        subprocess.run([docker, "buildx", "build", "--platform", config["platform"],
                        "--build-arg", "BUILD_IMAGE=" + config["image"],
                        "--build-arg", "STORE_CACHE=bookorbit-native-source-v11-" + preload_key, "--target", "artifact",
                        "--output", "type=local,dest=" + str(artifact), "--progress=plain", str(context)], check=True)
        generated = json.loads((artifact / "source-build.json").read_text())
        if generated.get("sourceCommit") != report["sourceCommit"] or not generated.get("sharpNativeCheck"):
            raise ValueError("Source build provenance or native dependency check failed")
        if digest(artifact / "sources/bookorbit-source.tar").hex() != report["sourceArchiveSha256"]:
            raise ValueError("Corresponding source archive mismatch")
        artifact.rename(output)
    return generated


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parents[3]))
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--docker", default="docker")
    parser.add_argument("--preload-store")
    args = parser.parse_args()
    print(json.dumps(build(args.repo, args.output, args.cache, args.docker, args.preload_store)))
