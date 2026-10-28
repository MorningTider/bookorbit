#!/usr/bin/env python3
"""Collect build-installed support components without changing a DSM host."""
import hashlib
import functools
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess

TOOLS = ("ffmpeg", "ffprobe", "pdfinfo", "pdftoppm", "pdftotext", "pdffonts", "ddjvu", "djvused", "c44", "fc-match")


@functools.lru_cache(maxsize=2048)
def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=60)


@functools.lru_cache(maxsize=2048)
def owner(path):
    if str(path).startswith("/opt/bookorbit-poppler/bin/"): return "poppler-utils"
    if str(path).startswith("/opt/bookorbit-poppler/lib/"): return "libpoppler126"
    candidates = [str(path)]
    if str(path).startswith("/usr/lib/"): candidates.append(str(path).replace("/usr/lib/", "/lib/", 1))
    if str(path).startswith("/lib/"): candidates.append("/usr" + str(path))
    for candidate in candidates:
        try: return run("dpkg-query", "-S", candidate).split(": ", 1)[0].splitlines()[0]
        except subprocess.CalledProcessError: pass
    raise ValueError("Unowned support component: " + str(path))


def main():
    output = pathlib.Path("/out/support")
    if output.exists(): raise ValueError("Support output must be new")
    output.mkdir()
    binaries = output / "bin";binaries.mkdir()
    private = output / "private-lib";private.mkdir()
    packages = {"ca-certificates"};libraries = {};tools = {}
    for name in TOOLS:
        custom = pathlib.Path("/opt/bookorbit-poppler/bin") / name
        original = (custom if custom.is_file() else pathlib.Path(shutil.which(name) or "missing")).resolve(strict=True)
        shutil.copyfile(original, binaries / name);(binaries / name).chmod(0o755)
        packages.add(owner(original));tools[name] = {"sha256": digest(original), "origin": "source-patched-poppler" if custom.is_file() else "debian"}
    python = output / "python"
    (python / "bin").mkdir(parents=True)
    shutil.copyfile("/usr/bin/python3.11", python / "bin/python3.11")
    (python / "bin/python3.11").chmod(0o755)
    packages.add(owner(pathlib.Path("/usr/bin/python3.11")))
    shutil.copytree("/usr/lib/python3.11", python / "lib/python3.11", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree("/build/python-env/lib/python3.11/site-packages", python / "lib/python3.11/site-packages",
                    ignore=shutil.ignore_patterns("pip", "pip-*", "setuptools", "setuptools-*", "pkg_resources", "_distutils_hack", "distutils-precedence.pth", "__pycache__"))
    # Attribute stdlib/data files to Debian packages; pip components have a separate receipt.
    stdlib_owners = run("dpkg-query", "-S", "/usr/lib/python3.11/*")
    for line in stdlib_owners.splitlines():
        packages.update(line.split(": ", 1)[0].split(", "))
    data = output / "poppler-data"
    shutil.copytree("/usr/share/poppler", data)
    packages.add("poppler-data")
    fonts = output / "fonts";fonts.mkdir()
    fontfiles = list(pathlib.Path("/usr/share/fonts/opentype/noto").glob("*CJK-Regular.ttc"))
    fontfiles += list(pathlib.Path("/usr/share/fonts/opentype/noto").glob("*CJK-Bold.ttc"))
    fontfiles += list(pathlib.Path("/usr/share/fonts/truetype/dejavu").glob("*.ttf"))
    if not fontfiles: raise ValueError("No bundled fonts")
    for font in fontfiles:
        shutil.copyfile(font, fonts / font.name);packages.add(owner(font))
    config = output / "fontconfig";config.mkdir()
    (config / "fonts.conf").write_text('''<?xml version="1.0"?>
<fontconfig><dir prefix="relative">../fonts</dir><cachedir prefix="xdg">fontconfig</cachedir>
<alias><family>sans-serif</family><prefer><family>Noto Sans CJK SC</family><family>DejaVu Sans</family></prefer></alias>
<alias><family>serif</family><prefer><family>Noto Serif CJK SC</family><family>DejaVu Serif</family></prefer></alias>
</fontconfig>
''')
    elf = list(binaries.iterdir()) + [python / "bin/python3.11"]
    elf += [p for p in python.rglob("*.so") if p.is_file()]
    ldenv = os.environ.copy();ldenv["LD_LIBRARY_PATH"] = "/opt/bookorbit-poppler/lib"
    for path in elf:
        result = subprocess.run(["ldd", str(path)], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30, env=ldenv)
        if result.returncode or "not found" in result.stdout: raise ValueError("Unresolved support library: " + path.name)
        for line in result.stdout.splitlines():
            match = re.search(r"(?:=>\s+|^\s*)(/[^\s()]+)", line)
            if not match: continue
            source = pathlib.Path(match.group(1)).resolve();package = owner(source)
            name = pathlib.Path(match.group(1)).name;sha = digest(source)
            if name in libraries and libraries[name]["sha256"] != sha: raise ValueError("Support SONAME collision")
            if name not in libraries: shutil.copyfile(source, private / name)
            packages.add(package)
            if name == "ld-linux-x86-64.so.2": (private / name).chmod(0o755)
            libraries[name] = {"package": package, "sha256": sha, "origin": "source-patched-poppler" if str(source).startswith("/opt/bookorbit-poppler/") else "debian"}
    for name in ("libnss_files.so.2", "libnss_dns.so.2", "libresolv.so.2", "libdl.so.2", "libpthread.so.0", "librt.so.1", "libutil.so.1", "libanl.so.1"):
        source = pathlib.Path("/lib/x86_64-linux-gnu") / name
        if source.is_file() and name not in libraries:
            source = source.resolve();package = owner(source)
            if package.split(":", 1)[0] != "libc6": raise ValueError("Unexpected libc provider")
            shutil.copyfile(source, private / name);packages.add(package)
            libraries[name] = {"package": package, "sha256": digest(source), "origin": "debian"}
    licenses = output / "licenses";licenses.mkdir()
    installed = []
    for package in sorted(packages):
        name = package.split(":", 1)[0]
        version = run("dpkg-query", "-W", "-f=${Version}", package)
        source = pathlib.Path("/usr/share/doc") / name / "copyright"
        if not source.is_file(): raise ValueError("Missing support copyright: " + name)
        shutil.copyfile(source, licenses / (name + "-copyright"))
        metadata = run("apt-cache", "show", package + "=" + version)
        (licenses / (name + "-apt-metadata.txt")).write_text(metadata)
        installed.append({"name": package, "version": version})
    shutil.copytree("/usr/share/common-licenses", licenses / "common-licenses")
    shutil.copyfile("/etc/ssl/certs/ca-certificates.crt", output / "ca-certificates.crt")
    patchdir = pathlib.Path("/build/poppler-patch")
    if patchdir.is_dir():
        sources = output / "sources/poppler";sources.mkdir(parents=True)
        for path in pathlib.Path("/build/poppler-downloads").iterdir():
            if path.is_file(): shutil.copyfile(path, sources / path.name)
        for path in patchdir.iterdir(): shutil.copyfile(path, sources / path.name)
        shutil.copyfile("/build/build-poppler.sh", sources / "build-poppler.sh")
        shutil.copyfile("/out/poppler-source-apt-records.txt", sources / "source-apt-records.txt")
    spec = importlib.util.spec_from_file_location("support_abi", "/build/support-abi.py")
    abi = importlib.util.module_from_spec(spec);spec.loader.exec_module(abi)
    required = set()
    for path in elf + list(private.iterdir()):
        required.update(abi.parse_symbols(run("readelf", "--dyn-syms", "--wide", str(path))))
    receipt = {"schemaVersion": 1, "requiredLibcSymbols": sorted(required), "status": "prototype-not-release", "libcMode": "private-loader", "minimumKernel": "4.4",
               "pythonVersion": "3.11", "tools": tools, "libraries": libraries, "debianPackages": installed,
               "collectorSha256": digest(pathlib.Path(__file__)), "pending": ["corresponding sources", "locked rebuild", "DSM support verification"]}
    (output / "support-manifest.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps({"supportTools": len(tools), "privateLibraries": len(libraries), "debianPackages": len(installed)}), flush=True)


if __name__ == "__main__": main()
