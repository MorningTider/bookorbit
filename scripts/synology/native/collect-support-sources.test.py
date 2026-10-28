import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('sources',pathlib.Path(__file__).with_name('collect-support-sources.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class SourcePlanTests(unittest.TestCase):
    def package(self,name='foo',version='1:2.3-4'):
        return {'source':name,'sourceVersion':version}

    def test_shared_source_downloaded_once(self):
        self.assertEqual(module.source_plan({'debian':[self.package(),self.package()]}), [('foo','1:2.3-4')])

    def test_distinct_versions_preserved(self):
        self.assertEqual(len(module.source_plan({'debian':[self.package(),self.package(version='2.4')]})),2)

    def test_unsafe_source_name_rejected(self):
        with self.assertRaisesRegex(ValueError,'identity'):module.source_plan({'debian':[self.package('../foo')]})

    def test_option_injection_rejected(self):
        with self.assertRaisesRegex(ValueError,'identity'):module.source_plan({'debian':[self.package(version='1 --allow-unauthenticated')]})

    def test_empty_plan_rejected(self):
        with self.assertRaisesRegex(ValueError,'bounded'):module.source_plan({'debian':[]})


if __name__=='__main__':unittest.main()
