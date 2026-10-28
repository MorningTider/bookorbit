#!/usr/bin/env python3
"""Inspect versioned libc symbols without calling the resolved functions."""
import ctypes
import re


def parse_symbols(text):
    result = set()
    for line in text.splitlines():
        if not re.search(r"\bGLOBAL\s+\S+\s+UND\s", line): continue
        match = re.search(r"\bUND\s+([A-Za-z_][A-Za-z0-9_]*)@+(GLIBC_[0-9.]+)", line)
        if match: result.add(match.group(1) + "@" + match.group(2))
    return sorted(result)


def missing_symbols(requirements, lookup):
    if not isinstance(requirements, list) or not requirements or len(requirements) > 4096:
        raise ValueError("A bounded host ABI requirement list is required")
    result = []
    for item in requirements:
        if not isinstance(item, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*@GLIBC_[0-9]+(?:\.[0-9]+)*", item):
            raise ValueError("Invalid host ABI symbol")
        name, version = item.split("@", 1)
        if not lookup(name, version): result.append(item)
    return sorted(set(result))


def process_missing(requirements):
    libraries = [ctypes.CDLL(None)]
    for name in ("libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0", "librt.so.1", "libresolv.so.2", "libutil.so.1", "libanl.so.1"):
        try: libraries.append(ctypes.CDLL(name))
        except OSError: pass
    resolver = next((getattr(library, "dlvsym", None) for library in libraries if getattr(library, "dlvsym", None)), None)
    if resolver is None: raise ValueError("Host versioned symbol lookup is unavailable")
    resolver.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
    resolver.restype = ctypes.c_void_p
    def lookup(name, version):
        return any(resolver(library._handle, name.encode("ascii"), version.encode("ascii")) for library in libraries)
    return missing_symbols(requirements, lookup)
