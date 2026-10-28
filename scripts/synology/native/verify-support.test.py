import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('support',pathlib.Path(__file__).with_name('verify-support.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class SupportVerifierPolicyTests(unittest.TestCase):
    def test_unbounded_wait_rejected(self):
        for value in [0,181]:
            with self.assertRaisesRegex(ValueError,'Bounded'):m.verify('/missing','/unused','/missing',value)
    def test_root_rejected_without_creating_output(self):
        with patch.object(m.os,'geteuid',return_value=0):
            with self.assertRaisesRegex(ValueError,'ordinary user'):m.verify('/missing','/unused','/missing',120)
    def test_existing_report_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary);output=root/'report.json';output.write_text('preserve')
            with self.assertRaisesRegex(ValueError,'Report must be new'):m.verify(root,output,root,120)
            self.assertEqual(output.read_text(),'preserve')
    def test_absent_tools_cannot_produce_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary);output=root/'report.json';candidate=root/'candidate';candidate.mkdir()
            with patch('builtins.print'):
                report=m.verify(candidate,output,root,120)
            self.assertFalse(report['passed']);self.assertEqual(report['toolTimeoutSeconds'],120)
            self.assertTrue(report['temporarySamplesRemoved']);self.assertEqual(len(report['checks']),6)
            self.assertEqual(output.stat().st_mode&0o777,0o600)


if __name__=='__main__':unittest.main()
