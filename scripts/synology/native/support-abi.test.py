#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("support_abi", pathlib.Path(__file__).with_name("support-abi.py"))
module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class AbiTests(unittest.TestCase):
    def test_collects_strong_versioned_host_requirements_only(self):
        table = """  1: 0000000000000000 0 FUNC GLOBAL DEFAULT UND memcpy@GLIBC_2.14 (3)
  2: 0000000000000000 0 FUNC WEAK DEFAULT UND optional@GLIBC_2.36 (5)
  3: 0000000000000000 0 FUNC GLOBAL DEFAULT UND _Unwind_Resume@GCC_3.0 (2)
  4: 0000000000000000 0 FUNC GLOBAL DEFAULT 11 local@GLIBC_2.2.5
  5: 0000000000000000 0 FUNC GLOBAL DEFAULT UND arc4random_buf@GLIBC_2.36 (5)
"""
        self.assertEqual(module.parse_symbols(table), ["arc4random_buf@GLIBC_2.36", "memcpy@GLIBC_2.14"])

    def test_missing_symbol_keeps_exact_version(self):
        missing = module.missing_symbols(["memcpy@GLIBC_2.14", "arc4random_buf@GLIBC_2.36"], lambda name, version: name == "memcpy")
        self.assertEqual(missing, ["arc4random_buf@GLIBC_2.36"])

    def test_invalid_symbol_rejected_before_lookup(self):
        def lookup(*args): self.fail("invalid metadata must not reach the resolver")
        with self.assertRaises(ValueError): module.missing_symbols(["invalid/path@GLIBC_2.36"], lookup)

    def test_unbounded_metadata_rejected(self):
        with self.assertRaises(ValueError): module.missing_symbols(["memcpy@GLIBC_2.14"] * 4097, lambda *args: True)

    def test_missing_manifest_requirements_rejected(self):
        with self.assertRaises(ValueError): module.missing_symbols([], lambda *args: True)


if __name__ == "__main__": unittest.main()
