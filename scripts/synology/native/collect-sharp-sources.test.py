import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('sources',pathlib.Path(__file__).with_name('collect-sharp-sources.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class SourceRecipeTests(unittest.TestCase):
    def test_substitutes_versions_without_running_shell(self):
        recipe='$CURL https://example.org/$(without_patch $VERSION_GLIB)/glib-${VERSION_GLIB}.tar.xz | tar xJC ${DEPS}/glib --strip-components=1'
        self.assertEqual(m.source_plan(recipe,{'glib':'2.90.0'})[0]['url'],'https://example.org/2.90/glib-2.90.0.tar.xz')
    def test_supported_version_transformation(self):
        recipe='$CURL https://example.org/VER-${VERSION_FREETYPE//./-}.tar.gz | tar xzC ${DEPS}/freetype'
        self.assertIn('VER-2-14-3',m.source_plan(recipe,{'freetype':'2.14.3'})[0]['url'])
    def test_missing_archive_rejected(self):
        with self.assertRaisesRegex(ValueError,'cover'):m.source_plan('',{'vips':'8.18.7'})
    def test_unrecognized_shell_expression_rejected(self):
        recipe='$CURL https://example.org/$(whoami).tar.gz | tar xzC ${DEPS}/vips'
        with self.assertRaisesRegex(ValueError,'Unresolved'):m.source_plan(recipe,{'vips':'8.18.7'})
    def test_duplicate_archive_rejected(self):
        line='$CURL https://example.org/vips.tar.gz | tar xzC ${DEPS}/vips'
        with self.assertRaisesRegex(ValueError,'Duplicate'):m.source_plan(line+'\n'+line,{'vips':'8.18.7'})


if __name__=='__main__':unittest.main()
