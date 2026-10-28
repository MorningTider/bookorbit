#!/usr/bin/env python3
"""Keep Poppler CMaps relocatable without changing system resource directories."""
import argparse
import difflib
import hashlib
import json
import pathlib

NEEDLE = "    const char *dataRoot = popplerDataDir ? popplerDataDir : POPPLER_DATADIR;"
REPLACEMENT = """    const char *dataRoot = popplerDataDir;
    if (!dataRoot) {
        dataRoot = std::getenv("BOOKORBIT_POPPLER_DATADIR");
        if (!dataRoot || !*dataRoot) {
            dataRoot = POPPLER_DATADIR;
        }
    }"""


def patch(source, output):
    source = pathlib.Path(source);output = pathlib.Path(output)
    before = source.read_text()
    if before.count(NEEDLE) != 1 or "BOOKORBIT_POPPLER_DATADIR" in before:
        raise ValueError("Poppler source layout is not the reviewed version")
    after = "#include <cstdlib>\n" + before.replace(NEEDLE, REPLACEMENT)
    output.mkdir(parents=True, exist_ok=False)
    diff = "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                    fromfile="a/poppler/GlobalParams.cc", tofile="b/poppler/GlobalParams.cc", n=2))
    (output / "bookorbit-private-data.patch").write_text(diff)
    receipt = {"beforeSha256": hashlib.sha256(before.encode()).hexdigest(),
               "afterSha256": hashlib.sha256(after.encode()).hexdigest(),
               "patchSha256": hashlib.sha256(diff.encode()).hexdigest(),
               "environment": "BOOKORBIT_POPPLER_DATADIR"}
    (output / "patch-receipt.json").write_text(json.dumps(receipt, indent=2))
    source.write_text(after)
    return receipt


if __name__ == "__main__":
    p = argparse.ArgumentParser();p.add_argument("--source", required=True);p.add_argument("--output", required=True)
    a = p.parse_args();print(json.dumps(patch(a.source, a.output)))
