import copy
import importlib.util
import unittest

spec=importlib.util.spec_from_file_location('split_library',__file__.replace('.test.py','.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SplitLibraryTests(unittest.TestCase):
    def fixture(self):
        return {'library':{'id':1,'type':'books','organization_mode':'book_per_folder'},'books':[{'id':11,'status':'present','primary_file_id':100,'folder_path':'/library/series'}],'files':[{'id':100,'book_id':11,'absolute_path':'/library/series/one.txt','format':'txt','role':'content'},{'id':101,'book_id':11,'absolute_path':'/library/series/two.txt','format':'txt','role':'content'}],'metadata':[{'book_id':11,'title':'┏━━┳━━┓','locked_fields':[]}]}
    def test_splits_different_titles_and_preserves_primary_book_and_file_ids(self):
        result=m.plan(self.fixture());self.assertEqual(result['newBooks'],2)
        self.assertEqual([g['reuseBookId'] for g in result['groups']],[11,None])
        self.assertEqual([g['fileIds'] for g in result['groups']],[[100],[101]])
        self.assertTrue(result['groups'][0]['replaceInvalidTitle'])
    def test_preserves_attached_editions_with_same_stem(self):
        snapshot=self.fixture();snapshot['files'][1].update(absolute_path='/library/series/one.pdf',format='pdf')
        result=m.plan(snapshot);self.assertEqual(result['newBooks'],1);self.assertEqual(result['groups'][0]['fileIds'],[100,101])
    def test_preserves_meaningful_existing_title(self):
        snapshot=self.fixture();snapshot['metadata'][0]['title']='User title'
        self.assertFalse(m.plan(snapshot)['groups'][0]['replaceInvalidTitle'])
    def test_locked_invalid_title_is_not_overwritten(self):
        snapshot=self.fixture();snapshot['metadata'][0]['locked_fields']=['title']
        with self.assertRaisesRegex(ValueError,'Locked'):m.plan(snapshot)
    def test_audio_and_sidecars_require_separate_review(self):
        for key,value in [('format','m4a'),('role','supplement')]:
            snapshot=self.fixture();snapshot['files'][1][key]=value
            with self.assertRaisesRegex(ValueError,'ebook content'):m.plan(snapshot)
    def test_missing_primary_file_is_rejected(self):
        snapshot=self.fixture();snapshot['books'][0]['primary_file_id']=900
        with self.assertRaisesRegex(ValueError,'primary'):m.plan(snapshot)
    def test_duplicate_edition_is_rejected(self):
        snapshot=self.fixture();snapshot['files'][1]['absolute_path']='/library/series/ONE.txt'
        with self.assertRaisesRegex(ValueError,'Ambiguous'):m.plan(snapshot)
    def test_completed_migration_is_not_reapplied(self):
        snapshot=self.fixture();snapshot['library']['organization_mode']='book_per_file'
        with self.assertRaisesRegex(ValueError,'folder-organized'):m.plan(snapshot)
    def test_statement_does_not_delete_books_or_files(self):
        sql=m.transaction(m.plan(self.fixture()))
        self.assertNotIn('DELETE FROM books ',sql);self.assertNotIn('DELETE FROM book_files ',sql)
        self.assertIn("organization_mode='book_per_file'",sql)
        self.assertIn('Migration snapshot is stale',sql)
    def test_book_title_cannot_terminate_dollar_quoted_body(self):
        snapshot=self.fixture();snapshot['files'][1]['absolute_path']="/library/series/$repair$ O'Brien.txt"
        sql=m.transaction(m.plan(snapshot));self.assertIn("/library/series/$repair$ O''Brien.txt",sql)
        self.assertTrue(sql.startswith('BEGIN; SET LOCAL standard_conforming_strings=on;'))
        self.assertNotIn('DO $repair$ ',sql)
    def test_invalid_ids_are_rejected(self):
        snapshot=self.fixture();snapshot['files'][0]['id']='100; delete'
        with self.assertRaisesRegex(ValueError,'identity'):m.plan(snapshot)

    def test_primary_reading_attempts_are_retained(self):
        import json
        class Admin:
            def sql(self,query,database):
                if 'pg_constraint' in query:return json.dumps([{'table_name':'reading_attempts','column_name':'book_id','target':'books'}])
                if 'json_build_object' in query:return '{"rows":1,"digest":"unchanged"}'
                if 'FROM reading_attempts' in query:return '1'
                return '0'
        result=m.related(Admin(),'isolated',m.plan(self.fixture()))
        self.assertEqual(result['reading_attempts'],{'rows':1,'digest':'unchanged'})
    def test_sessions_on_non_primary_file_are_not_silently_reassigned(self):
        class Admin:
            def sql(self,query,database):
                if 'pg_constraint' in query:return '[]'
                return '1'
        with self.assertRaisesRegex(ValueError,'non-primary'):m.related(Admin(),'isolated',m.plan(self.fixture()))

if __name__=='__main__':unittest.main()
