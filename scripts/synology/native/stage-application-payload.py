#!/usr/bin/env python3
"""Export only frozen application assets; Docker is a read-only build input."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import tempfile


def sha(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def stage(container, materials, output, docker):
    materials = pathlib.Path(materials).resolve(strict=True)
    output = pathlib.Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError("Output must be a new directory")
    lockpath = pathlib.Path(__file__).with_name("runtime-source-lock.json")
    lock = json.loads(lockpath.read_text())
    image = subprocess.check_output([docker, "inspect", "--format", "{{.Image}}", container], text=True).strip()
    if image != lock["media"]["baseImage"]:
        raise ValueError("Application image does not match the source lock")
    archive = materials / ("bookorbit-node-v" + lock["node"]["version"] + "-linux-x64.tar.xz")
    atomic = materials / "bookorbit-libatomic.so.1"
    sharp = materials / "sharp-native-probe-20261026.tgz"
    if sha(archive) != lock["node"]["sha256"] or sha(atomic) != lock["libatomic"]["binarySha256"]:
        raise ValueError("Native runtime materials do not match the source lock")
    if sha(sharp) != "511f01f0026fc97e9dcdc9ad88ce923503a01c742cabdaf835a2e601a9639c27":
        raise ValueError("Sharp material does not match the verified probe")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = pathlib.Path(tempfile.mkdtemp(prefix=".bookorbit-stage-", dir=output.parent))
    temporary.chmod(0o700)
    try:
        (temporary / "app").mkdir()
        subprocess.run([docker, "cp", container + ":/app/.", str(temporary / "app")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=600)
        # Recheck identity after export rather than accepting a replaced named container.
        final = subprocess.check_output([docker, "inspect", "--format", "{{.Image}}", container], text=True).strip()
        if final != image:
            raise ValueError("Source container changed during export")
        (temporary / "bin").mkdir()
        (temporary / "lib").mkdir()
        (temporary / "licenses/node").mkdir(parents=True)
        prefix = "node-v" + lock["node"]["version"] + "-linux-x64/"
        with tarfile.open(archive) as source:
            for member, destination in ((prefix + "bin/node", "bin/node"),
                                        (prefix + "LICENSE", "licenses/node/LICENSE")):
                entry = source.getmember(member)
                if not entry.isfile():
                    raise ValueError("Invalid Node archive member")
                with source.extractfile(entry) as src, (temporary / destination).open("wb") as dest:
                    shutil.copyfileobj(src, dest)
        (temporary / "bin/node").chmod(0o755)
        if sha(temporary / "bin/node") != lock["node"]["binarySha256"]:
            raise ValueError("Extracted Node binary does not match source lock")
        shutil.copyfile(atomic, temporary / "lib/libatomic.so.1")
        with tarfile.open(sharp) as source:
            for entry in source:
                name = pathlib.PurePosixPath(entry.name)
                if name.is_absolute() or ".." in name.parts or not (entry.isfile() or entry.isdir()):
                    raise ValueError("Invalid Sharp archive path or type")
                if not entry.name.startswith("node_modules/@img/"):
                    continue
                target = temporary / "app" / entry.name
                if target.is_symlink():
                    raise ValueError("Sharp destination is a symlink")
                # Parent links must stay within this freshly exported tree.
                target.parent.resolve().relative_to(temporary)
                if entry.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(entry) as src, target.open("wb") as dest:
                        shutil.copyfileobj(src, dest)
        spec = importlib.util.spec_from_file_location("payload_contract", pathlib.Path(__file__).with_name("payload-contract.py"))
        contract = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(contract)
        pruned = []
        example = temporary / "app/.env.example"
        if example.is_file() and not example.is_symlink():
            pruned.append("app/.env.example")
            example.unlink()
        for editor in (temporary / "app/node_modules").rglob(".vscode/settings.json"):
            if editor.is_file() and not editor.is_symlink():
                editor.resolve().relative_to(temporary)
                pruned.append(editor.relative_to(temporary).as_posix())
                editor.unlink()
        workspace = temporary / "app/node_modules/.pnpm/node_modules/server"
        if workspace.is_symlink() and os.readlink(str(workspace)) == "../../../../app/server" and not workspace.exists():
            pruned.append(workspace.relative_to(temporary).as_posix())
            workspace.unlink()
        files = contract.inventory(temporary)
        # Root sessions may use umask077; only the outer staging directory stays private.
        for base, directories, names in os.walk(temporary, followlinks=False):
            current = pathlib.Path(base)
            if current != temporary:
                current.chmod(0o755)
            for name in names:
                path = current / name
                if not path.is_symlink():
                    path.chmod(0o755 if path.stat().st_mode & 0o111 else 0o644)
        report = {"schemaVersion": 1, "buildImage": image, "architecture": "x86_64",
                  "status": "application-only-not-distributable", "files": files,
                  "prunedDevelopmentFiles": sorted(pruned),
                  "pending": ["media runtime and wrappers", "Python integration", "component provenance and corresponding source audit",
                              "SPK lifecycle", "native functional acceptance"]}
        # The external report cannot accidentally become part of its own hash inventory.
        report_path = output.with_name(output.name + ".inventory.json")
        with report_path.open("x") as stream:
            os.chmod(report_path, 0o600)
            json.dump(report, stream, indent=2)
        try:
            temporary.rename(output)
        except BaseException:
            report_path.unlink()
            raise
        return {"output": str(output), "files": len(files), "status": report["status"]}
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", required=True)
    parser.add_argument("--materials", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--docker", default="/var/packages/ContainerManager/target/usr/bin/docker")
    args = parser.parse_args()
    print(json.dumps(stage(args.container, args.materials, args.output, args.docker)))
