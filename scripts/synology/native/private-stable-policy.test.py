import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('private_policy',pathlib.Path(__file__).with_name('private-stable-policy.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class PrivateStablePolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.path=pathlib.Path(self.tmp.name)/'proof.json'
        self.installed={'packageVersion':'3.5.0-10007','productionEnabled':True,'sourceCommit':'a'*40,'payloadInventorySha256':'b'*64,'controllerSha256':'c'*64,'applicationMigrationSha256':'d'*64}
        self.value={'kind':'private-stable-readiness','publicationScope':'private','installed':self.installed,'api':{'kind':'installed-native-production-api','packageVersion':'3.5.0-10007','passed':True,'tokensTransferred':False,'readOnlyApiRequests':True,'checks':dict.fromkeys(m.CHECKS,True)}}
    def validate(self):
        self.path.write_text(json.dumps(self.value));return m.validate(self.path,'a'*40,'b'*64,'c'*64,'d'*64,10008)
    def test_matching_live_acceptance(self):self.assertEqual(self.validate(),m.digest(self.path))
    def test_public_scope_is_not_implicitly_approved(self):
        self.value['publicationScope']='public'
        with self.assertRaisesRegex(ValueError,'Self-use'):self.validate()
    def test_changed_program_or_controller_needs_new_acceptance(self):
        original=copy.deepcopy(self.installed)
        for key in ['sourceCommit','payloadInventorySha256','controllerSha256','applicationMigrationSha256']:
            self.value['installed']=dict(original,**{key:'different'})
            with self.assertRaisesRegex(ValueError,'differs'):self.validate()
    def test_stale_api_version_is_rejected(self):
        self.value['api']['packageVersion']='3.5.0-10006'
        with self.assertRaisesRegex(ValueError,'API acceptance'):self.validate()
    def test_missing_or_failed_api_check_is_rejected(self):
        for key in m.CHECKS:
            self.value['api']['checks']=dict.fromkeys(m.CHECKS,True);self.value['api']['checks'][key]=False
            with self.assertRaisesRegex(ValueError,'API acceptance'):self.validate()
    def test_unsafe_api_receipt_is_rejected(self):
        self.value['api']['tokensTransferred']=True
        with self.assertRaisesRegex(ValueError,'API acceptance'):self.validate()
    def test_same_or_older_revision_is_rejected(self):
        self.value['installed']['packageVersion']='3.5.0-10008'
        with self.assertRaisesRegex(ValueError,'newer'):self.validate()
    def test_accepts_matching_3_7_evidence(self):
        self.installed['packageVersion']='3.7.0-10042'
        self.value['api']['packageVersion']='3.7.0-10042'
        self.path.write_text(json.dumps(self.value))
        self.assertEqual(m.validate(self.path,'a'*40,'b'*64,'c'*64,'d'*64,10043,'3.7.0'),m.digest(self.path))
        with self.assertRaisesRegex(ValueError,'newer'):
            m.validate(self.path,'a'*40,'b'*64,'c'*64,'d'*64,10043,'3.5.0')
    def test_stable_labels_do_not_approve_public_redistribution(self):
        metadata={'pending':['acceptance']};fields={'beta':'yes','version':'3.5.0-10008'}
        m.apply_metadata(metadata,'e'*64);m.apply_info(fields)
        self.assertNotIn('beta',fields)
        self.assertNotIn('候选',fields['description_chs'])
        self.assertEqual(fields['version'],'3.5.0-10008')
        self.assertTrue(metadata['productionEnabled'])
        self.assertFalse(metadata['publicRedistributionApproved'])
        self.assertEqual(metadata['publicationScope'],'private')


if __name__=='__main__':unittest.main()
