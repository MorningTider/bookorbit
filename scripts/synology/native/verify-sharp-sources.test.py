import hashlib
import base64
import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('upstream_sources',pathlib.Path(__file__).with_name('verify-sharp-sources.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class SourceIdentityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.archive=pathlib.Path(self.tmp.name)/'source.tar'
    def fixture(self,name='project/code.c',data=b'source',mode=0o644,link=None):
        with tarfile.open(self.archive,'w') as tar:
            entry=tarfile.TarInfo(name);entry.mode=mode
            if link is None:
                entry.size=len(data);tar.addfile(entry,io.BytesIO(data))
            else:
                entry.type=tarfile.SYMTYPE;entry.linkname=link;tar.addfile(entry)
        blob=link.encode() if link is not None else data
        return {'tree':[{'path':'code.c','type':'blob','mode':'120000' if link else ('100755' if mode&0o111 else '100644'),'sha':hashlib.sha1(b'blob '+str(len(blob)).encode()+b'\0'+blob).hexdigest()}],'truncated':False}
    def test_matching_commit_content(self):
        tree=self.fixture();result=m.verify_tree(self.archive,tree)
        self.assertEqual(result['gitBlobsMatched'],1)
        self.assertFalse(result['sourceCompletenessApproved'])
    def test_changed_archive_is_rejected(self):
        tree=self.fixture();self.fixture(data=b'changed')
        with self.assertRaisesRegex(ValueError,'differs'):m.verify_tree(self.archive,tree)
    def test_unsafe_path_is_rejected_without_extracting(self):
        tree=self.fixture(name='project/../escape')
        with self.assertRaisesRegex(ValueError,'Unsafe'):m.verify_tree(self.archive,tree)
        self.assertFalse((self.archive.parent/'escape').exists())
    def test_truncated_upstream_tree_is_rejected(self):
        tree=self.fixture();tree['truncated']=True
        with self.assertRaisesRegex(ValueError,'Complete'):m.verify_tree(self.archive,tree)
    def test_omitted_source_is_reported(self):
        tree=self.fixture();tree['tree'].append({'path':'omitted.c','type':'blob','mode':'100644','sha':'0'*40})
        self.assertEqual(m.verify_tree(self.archive,tree)['omittedPaths'],['omitted.c'])
    def test_symbolic_link_bytes_match_git_without_following(self):
        tree=self.fixture(link='somewhere.c');self.assertEqual(m.verify_tree(self.archive,tree)['gitBlobsMatched'],1)
    def test_execute_permission_must_match(self):
        tree=self.fixture();self.fixture(mode=0o755)
        with self.assertRaisesRegex(ValueError,'executable mode'):m.verify_tree(self.archive,tree)
    def test_checksum_matches_exact_filename(self):
        digest='a'*64;m.match_checksum(digest+'  source.tar.xz','source.tar.xz',digest)
        for text in [digest+' source.tar.xz.old','b'*64+' source.tar.xz',(digest+' source.tar.xz\n')*2]:
            with self.assertRaisesRegex(ValueError,'checksum'):m.match_checksum(text,'source.tar.xz',digest)

    def export_fixture(self,attributes):
        files={'.gitattributes':attributes,'build/script.ps1':b'one\ntwo\n'}
        tree={'tree':[],'truncated':False}
        with tarfile.open(self.archive,'w') as tar:
            for name,data in files.items():
                tree['tree'].append({'path':name,'type':'blob','mode':'100644','sha':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()})
                exported=data.replace(b'\n',b'\r\n') if name.endswith('.ps1') else data
                entry=tarfile.TarInfo('project/'+name);entry.mode=0o644;entry.size=len(exported);tar.addfile(entry,io.BytesIO(exported))
        return tree
    def test_crlf_export_requires_verified_explicit_attributes(self):
        tree=self.export_fixture(b'* text=auto\n*.ps1 text eol=crlf\n')
        result=m.verify_tree(self.archive,tree)
        self.assertEqual(result['exportTransformations'][0]['path'],'build/script.ps1')
    def test_crlf_without_attributes_is_rejected(self):
        tree=self.export_fixture(b'* text=auto\n')
        with self.assertRaisesRegex(ValueError,'differs'):m.verify_tree(self.archive,tree)
    def test_overriding_attributes_disallow_normalization(self):
        self.assertFalse(m.crlf_export_allowed('build/code.ps1','*.ps1 text eol=crlf\nbuild/code.ps1 -text',{}))
        self.assertFalse(m.crlf_export_allowed('build/code.ps1','*.ps1 text eol=crlf',{'build/.gitattributes':{}}))
    def test_sha512_exact_checksum(self):
        digest='c'*128;m.match_checksum(digest+'  source.tar.gz','source.tar.gz',digest)
    def test_official_md5_is_not_a_strong_checksum(self):
        self.archive.write_bytes(b'archive')
        metadata={'size':'7','md5Hash':base64.b64encode(hashlib.md5(b'archive').digest()).decode(),'generation':'42'}
        result=m.match_object_metadata(self.archive,metadata)
        self.assertTrue(result['officialObjectMd5Corroborated'])
        self.assertFalse(result['strongIndependentChecksumVerified'])
        metadata['size']='8'
        with self.assertRaisesRegex(ValueError,'differs'):m.match_object_metadata(self.archive,metadata)
    def test_gitlab_invalid_pagination_is_rejected(self):
        import json
        responses=[(json.dumps({'id':'a'*40}).encode(),''),(b'[]','1')]
        with patch.object(m,'upstream_bytes',side_effect=responses):
            with self.assertRaisesRegex(ValueError,'pagination'):m.gitlab_tree('gitlab.com','example/project','v1')
    def test_gitlab_multiple_pages_are_combined(self):
        import json
        responses=[(json.dumps({'id':'a'*40}).encode(),''),(b'[{"id":"b","path":"one","type":"blob","mode":"100644"}]','2'),(b'[]','')]
        with patch.object(m,'upstream_bytes',side_effect=responses):
            commit,tree=m.gitlab_tree('gitlab.com','example/project','v1')
        self.assertEqual(tree['tree'][0]['sha'],'b')
        self.assertFalse(tree['truncated'])

    def test_source_lock_rejects_changed_hash_or_recipe(self):
        import copy
        row={'name':'vips','url':'https://example.org/source.tar.xz','sha256':'a'*64}
        report={'recipeSha256':'recipe','versionsSha256':'versions','archives':[row]}
        lock={'schemaVersion':1,'recipeSha256':'recipe','versionsSha256':'versions','sourceArchives':[row]}
        m.validate_lock(report,lock)
        altered=copy.deepcopy(report);altered['archives'][0]['sha256']='b'*64
        with self.assertRaisesRegex(ValueError,'reviewed lock'):m.validate_lock(altered,lock)
        altered=copy.deepcopy(report);altered['recipeSha256']='different'
        with self.assertRaisesRegex(ValueError,'recipe'):m.validate_lock(altered,lock)
    def test_source_lock_rejects_duplicate_source(self):
        row={'name':'vips','url':'https://example.org/source.tar.xz','sha256':'a'*64}
        report={'recipeSha256':'recipe','versionsSha256':'versions','archives':[row,row]}
        lock={'schemaVersion':1,'recipeSha256':'recipe','versionsSha256':'versions','sourceArchives':[row]}
        with self.assertRaisesRegex(ValueError,'reviewed lock'):m.validate_lock(report,lock)


if __name__=='__main__':unittest.main()
