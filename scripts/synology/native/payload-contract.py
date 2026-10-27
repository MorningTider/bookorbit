#!/usr/bin/env python3
"""Validate a frozen, credential-free native package payload before SPK assembly."""
import hashlib
import json
import os
import pathlib
import re

REQUIRED = ("bin/node", "lib/libatomic.so.1", "app/dist/main.js",
            "app/dist/scripts/migrate.js", "app/public/index.html",
            "app/package.json", "app/LICENSE", "app/NOTICE",
            "app/ADDITIONAL_TERMS.md")
FORBIDDEN = {".env", "settings.json", "credentials.json", "id_rsa", "id_ed25519"}


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def inventory(root):
    """Internal dependency links are allowed; escaping or broken links are rejected."""
    root = pathlib.Path(root).resolve(strict=True)
    result = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.name in FORBIDDEN or path.name.startswith(".env."):
            raise ValueError("Private configuration is forbidden in payload")
        if relative.split("/")[0] in {"data", "books", "home", "backups"}:
            raise ValueError("Runtime data is forbidden in payload")
        if path.is_symlink():
            if pathlib.Path(os.readlink(str(path))).is_absolute():
                raise ValueError("Absolute payload symlinks cannot be relocated")
            target = path.resolve(strict=True)
            try:
                target.relative_to(root)
            except ValueError:
                raise ValueError("Payload symlink escapes its root") from None
            result[relative] = {"link": pathlib.Path(os.readlink(str(path))).as_posix()}
        elif path.is_file():
            result[relative] = {"sha256": digest(path), "bytes": path.stat().st_size,
                                "executable": bool(path.stat().st_mode & 0o111)}
        elif not path.is_dir():
            raise ValueError("Unsupported payload file type")
    return result


def validate(root, manifest):
    root = pathlib.Path(root).resolve(strict=True)
    if manifest.get("schemaVersion") != 1 or manifest.get("architecture") != "x86_64":
        raise ValueError("Unsupported native payload schema or architecture")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest.get("sourceCommit", "")):
        raise ValueError("A full source commit is required")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", manifest.get("buildImage", "")):
        raise ValueError("A pinned build image is required")
    actual = inventory(root)
    if actual != manifest.get("files"):
        raise ValueError("Payload inventory mismatch")
    for name in REQUIRED:
        if not (root / name).is_file():
            raise ValueError("Missing required native component: " + name)
    with (root / "bin/node").open("rb") as node:
        header = node.read(20)
    if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
        raise ValueError("Native Node must be an ELF executable")
    if not actual["bin/node"].get("executable"):
        raise ValueError("Native Node is not executable")
    lock = json.loads((pathlib.Path(__file__).parent / "runtime-source-lock.json").read_text())
    if digest(root / "bin/node") != lock["node"]["binarySha256"]:
        raise ValueError("Node does not match the runtime source lock")
    if digest(root / "lib/libatomic.so.1") != lock["libatomic"]["binarySha256"]:
        raise ValueError("libatomic does not match the runtime source lock")
    for tool in ("ffmpeg", "ffprobe", "pdfinfo", "pdftoppm", "pdftotext", "ddjvu", "djvused"):
        if not (root / "bin" / tool).is_file():
            raise ValueError("Missing media tool: " + tool)
    components = manifest.get("components")
    if not isinstance(components, list) or not components:
        raise ValueError("Component provenance and license audit is required")
    covered = set()
    for component in components:
        if not all(isinstance(component.get(key), str) and component[key].strip()
                   for key in ("name", "version", "source", "license")):
            raise ValueError("Incomplete component provenance")
        licenses = component.get("licenseFiles", [])
        if not licenses or any(name not in actual or not name.startswith("licenses/") for name in licenses):
            raise ValueError("Component license files are missing")
        if component.get("sourceRequired") is not False:
            sources = component.get("sourceFiles", [])
            if not sources or any(name not in actual or not name.startswith("sources/") for name in sources):
                raise ValueError("Required corresponding source is missing")
        files = component.get("files", [])
        if not files or any(name not in actual for name in files):
            raise ValueError("Component inventory is incomplete")
        covered.update(files)
    if set(actual) - covered:
        raise ValueError("Payload contains files without a component audit")
    return {"files": len(actual), "components": len(components),
            "bytes": sum(row.get("bytes", 0) for row in actual.values())}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    print(json.dumps(validate(args.payload, json.loads(pathlib.Path(args.manifest).read_text()))))
