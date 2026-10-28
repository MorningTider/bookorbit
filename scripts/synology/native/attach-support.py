#!/usr/bin/env python3
"""Create a new candidate with private support components and relocatable wrappers."""
import argparse
import importlib.util
import json
import pathlib
import shutil
import tempfile

TOOLS = ("ffmpeg", "ffprobe", "pdfinfo", "pdftoppm", "pdftotext", "pdffonts", "ddjvu", "djvused", "c44", "fc-match", "python3")


def attach(stage, support, output):
    stage = pathlib.Path(stage).resolve(strict=True)
    support = pathlib.Path(support).resolve(strict=True)
    output = pathlib.Path(output).absolute()
    if output.exists() or output.is_symlink(): raise ValueError("Support candidate output must be new")
    spec = importlib.util.spec_from_file_location("contract", pathlib.Path(__file__).with_name("payload-contract.py"))
    contract = importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)
    report = json.loads((support / "support-manifest.json").read_text())
    if report.get("schemaVersion") != 1 or report.get("libcMode") != "private-loader" or report.get("minimumKernel") != "4.4":
        raise ValueError("Unsupported support runtime")
    inventory = contract.inventory(support)
    for name in TOOLS:
        relative = "python/bin/python3.11" if name == "python3" else "bin/" + name
        path = support / relative
        if not path.is_file() or not inventory[relative].get("executable"):
            raise ValueError("Missing executable support tool: " + name)
        with path.open("rb") as stream: header = stream.read(20)
        if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
            raise ValueError("Support executable is not Linux x86_64")
        if name != "python3" and contract.digest(path) != report["tools"][name]["sha256"]:
            raise ValueError("Support executable checksum mismatch")
    loader = support / "private-lib/ld-linux-x86-64.so.2"
    if not loader.is_file() or not loader.stat().st_mode & 0o111:
        raise ValueError("Private libc loader is missing or not executable")
    for name, item in report["libraries"].items():
        if contract.digest(support / "private-lib" / name) != item["sha256"]:
            raise ValueError("Support library checksum mismatch")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".bookorbit-support-", dir=output.parent) as temporary:
        root = pathlib.Path(temporary) / "candidate"
        shutil.copytree(stage, root, symlinks=True)
        if (root / "support").exists(): raise ValueError("Stage already contains support components")
        shutil.copytree(support, root / "support", symlinks=True)
        launcher = pathlib.Path(__file__).with_name("support-launcher.sh").read_bytes()
        for name in TOOLS:
            target = root / "bin" / name
            if target.exists() or target.is_symlink(): raise ValueError("Support wrapper would overwrite an existing file")
            target.write_bytes(launcher);target.chmod(0o755)
        final = contract.inventory(root)
        receipt = {"schemaVersion": 1, "status": "support-candidate-not-release", "files": final,
                   "pending": ["locked support rebuild", "component source audit", "DSM support and application acceptance", "SPK lifecycle"]}
        destination = output.with_name(output.name + ".inventory.json")
        with destination.open("x") as stream: json.dump(receipt, stream, indent=2)
        try: root.rename(output)
        except BaseException: destination.unlink();raise
    return {"output": str(output), "files": len(final), "status": receipt["status"]}


if __name__ == "__main__":
    p = argparse.ArgumentParser();p.add_argument("--stage", required=True);p.add_argument("--support", required=True);p.add_argument("--output", required=True)
    a = p.parse_args();print(json.dumps(attach(a.stage, a.support, a.output)))
