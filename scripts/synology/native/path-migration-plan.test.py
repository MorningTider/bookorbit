import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('paths',pathlib.Path(__file__).with_name('path-migration-plan.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class PathPlanTests(unittest.TestCase):
    rules=[{'from':'/books','to':'/volume1/library'},{'from':'/data','to':'/volume1/bookorbit'}]
    def row(self, **changes):
        return {'table':'book_files','column':'absolute_path','kind':'scalar','value':'/books/中文/a.epub','count':1,'targetExists':False,**changes}
    def run_plan(self, rows):return m.plan({'schemaVersion':1,'readOnly':True,'auditComplete':True,'mappings':self.rules,'matches':rows},self.rules)
    def test_unicode_and_counts(self):
        result=self.run_plan([self.row(count=6468)])
        self.assertEqual(result['operations'][0]['new'],'/volume1/library/中文/a.epub')
        self.assertEqual(result['rowCounts']['book_files.absolute_path'],6468)
        self.assertTrue(result['readyForIsolationReplay'])
    def test_component_boundary(self):
        self.assertEqual(m.translate('/books-other/a',m.mappings(self.rules)),'/books-other/a')
    def test_unknown_field_blocks(self):
        self.assertFalse(self.run_plan([self.row(column='description')])['readyForIsolationReplay'])
    def test_json_blocks(self):
        self.assertFalse(self.run_plan([self.row(kind='json')])['readyForIsolationReplay'])
    def test_existing_destination_blocks(self):
        self.assertFalse(self.run_plan([self.row(targetExists=True)])['readyForIsolationReplay'])
    def test_missing_collision_evidence_blocks(self):
        row=self.row();del row['targetExists']
        self.assertFalse(self.run_plan([row])['readyForIsolationReplay'])
    def test_overlapping_sources_use_longest(self):
        rules=m.mappings(self.rules+[{'from':'/books/ebook','to':'/volume2/ebook'}])
        self.assertEqual(m.translate('/books/ebook/a.txt',rules),'/volume2/ebook/a.txt')
    def test_mapping_merge_rejected(self):
        rules=self.rules+[{'from':'/books/other','to':'/volume1/library'}]
        with self.assertRaisesRegex(ValueError,'merge'):m.plan({'schemaVersion':1,'readOnly':True,'auditComplete':True,'mappings':rules,'matches':[self.row(value='/books/a'),self.row(value='/books/other/a')]},rules)
    def test_noncanonical_rejected(self):
        for path in ['/books/../a','/books//a','relative','/','/books/a\\b']:
            with self.assertRaises(ValueError):m.validate_path(path)
    def test_chain_rejected(self):
        with self.assertRaisesRegex(ValueError,'re-enters'):m.mappings([{'from':'/books','to':'/data/books'},{'from':'/data','to':'/volume1/data'}])
    def test_duplicate_audit_rejected(self):
        with self.assertRaisesRegex(ValueError,'Duplicate'):self.run_plan([self.row(),self.row()])
    def test_empty_not_ready(self):self.assertFalse(self.run_plan([])['readyForIsolationReplay'])
    def test_incomplete_audit_rejected(self):
        with self.assertRaisesRegex(ValueError,'read-only'):m.plan({'schemaVersion':1,'readOnly':True,'matches':[]},self.rules)
    def test_changed_mapping_rejected(self):
        with self.assertRaisesRegex(ValueError,'differs'):m.plan({'schemaVersion':1,'readOnly':True,'auditComplete':True,'mappings':[{'from':'/books','to':'/other'}],'matches':[]},self.rules)
    def test_readonly_required(self):
        with self.assertRaisesRegex(ValueError,'read-only'):m.plan({'schemaVersion':1,'readOnly':False,'matches':[]},self.rules)


if __name__=='__main__':unittest.main()
